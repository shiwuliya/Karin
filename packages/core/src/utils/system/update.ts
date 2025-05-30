import fs from 'node:fs'
import { exec } from './exec'
import { requireFile } from '../fs/require'
import { getPlugins } from '@/plugin/system/list'

import type { Package } from '@/types/config'
import type { ExecException } from 'node:child_process'

const getPkg = (isForcibly = false): Promise<Package> => {
  return requireFile('package.json', { force: isForcibly })
}

/**
 * @description 传入npm包名 检查是否存在更新
 * @param name 包名
 * @returns 是否存在更新 true: 存在更新 false: 无更新
 */
export const checkPkgUpdate = async (name: string): Promise<
  {
    /** 存在更新 */
    status: 'yes',
    /** 本地版本号 */
    local: string,
    /** 远程版本号 */
    remote: string
  } | {
    /** 无更新 */
    status: 'no'
    /** 本地版本号 */
    local: string
  } | {
    /** 检查发生错误 */
    status: 'error',
    /** 错误信息 */
    error: Error
  }> => {
  const logger = global?.logger || console
  try {
    const local = await getPkgVersion(name)
    const remote = await getRemotePkgVersion(name)

    if (local === remote) return { status: 'no', local }
    return { status: 'yes', local, remote }
  } catch (error) {
    logger.error(error)
    return { status: 'error', error: error as Error }
  }
}

/**
 * @description 获取指定包的本地版本号 如果获取失败则会获取package.json中的版本号
 * @param name 包名
 */
export const getPkgVersion = async (name: string): Promise<string> => {
  const { stdout, error } = await exec(`npm list ${name} --depth=0`)
  if (stdout) {
    const data = stdout.toString()
    // node-karin@1.4.1 D:\\Github\\Karin-dev\\packages\\core\n└── @karinjs/plugin-basic@ extraneous
    if (data.includes('empty') || data.includes('extraneous')) {
      throw new Error(`获取失败，${name} 未安装`)
    }
    const reg = new RegExp(`${name}@(\\d+\\.\\d+\\.\\d+)`, 'gm')
    const result = reg.exec(data)
    if (result?.[1]) return result[1]
  }

  if (error) {
    if (error?.stack?.toString().includes('empty') || error?.stack?.toString().includes('extraneous')) {
      throw new Error(`获取失败，${name} 未安装`)
    }
    throw error
  }

  /** 兜底 使用package.json中的版本号 */
  const pkg = await getPkg()
  return pkg?.dependencies?.[name] || pkg?.devDependencies?.[name] || pkg?.peerDependencies?.[name]
}

/**
 * @description 获取指定包的远程版本号
 * @param name 包名
 * @param tag 标签，默认为 `latest`
 */
export const getRemotePkgVersion = async (name: string, tag = 'latest') => {
  const cmd = tag === 'latest' ? `npm show ${name} version` : `npm show ${name} dist-tags.${tag}`

  const { status, stdout, error } = await exec(cmd)
  if (!status) {
    if (error?.stack?.toString().includes('empty') || error?.stack?.toString().includes('extraneous')) {
      throw new Error(`获取失败，${name} 未安装`)
    }
    throw error
  }
  return stdout.toString().trim()
}

/**
 * @description 更新指定的npm插件
 * @param name 包名
 * @param tag 标签 默认 `latest`
 */
export const updatePkg = async (name: string, tag = 'latest'): Promise<{
  /** 更新失败 */
  status: 'failed',
  /** 更新失败信息 */
  data: string | ExecException
} | {
  /** 更新成功 */
  status: 'ok',
  /** 更新成功信息 */
  data: string,
  /** 本地版本号 */
  local: string,
  /** 远程版本号 */
  remote: string
}> => {
  const logger = global?.logger || console
  try {
    const local = await getPkgVersion(name)
    const remote = await getRemotePkgVersion(name, tag)

    if (local === remote) {
      return { status: 'failed', data: `[${name}][无更新] ${local} => ${remote}` }
    }

    const shell = `pnpm up ${name}@${remote}`
    const { error } = await exec(shell)
    if (error) {
      return { status: 'failed', data: error }
    }

    const updatedVersion = await getPkgVersion(name)
    if (updatedVersion !== remote) {
      return { status: 'failed', data: `[${name}][更新失败] 请尝试手动更新 pnpm up ${name}@${remote}` }
    }

    return { status: 'ok', data: `[${name}][更新成功] ${local} => ${remote}`, local, remote }
  } catch (error) {
    logger.error(error)
    return { status: 'failed', data: error as ExecException }
  }
}

/**
 * @description 更新全部npm插件
 */
export const updateAllPkg = async (): Promise<string> => {
  const logger = global?.logger || console
  try {
    const list = await getPlugins('npm', false)
    list.push('node-karin')

    const state: Record<string, {
      local: string | null
      remote: string
    }> = {}
    const tips = ['\n------- 更新npm插件 --------']
    const cmd = ['pnpm up']
    const pkg = await getPkg()
    const result: string[] = []

    await Promise.all(list.map(async (name) => {
      name = name.replace('npm:', '')
      /** 本地版本号 */
      const local = await getPkgVersion(name)
      /** 远程版本号 */
      const remote = await getRemotePkgVersion(name) || pkg.dependencies[name]
      /** 无更新 */
      if (local === remote) {
        tips.push(`[${name}][无更新] ${local} => ${remote}`)
        return
      }

      tips.push(`更新${name} ${local} => ${remote}`)
      cmd.push(`${name}@${remote}`)
      state[name] = { local, remote }
    }))

    if (cmd.length === 1) {
      tips.push('没有可更新的插件~')
      tips.push('---------------------------')
      logger.info(tips.join('\n'))
      return '没有可更新的插件~'
    } else {
      tips.push('----------------------------')
      logger.info(tips.join('\n'))
    }

    const shell = cmd.join(' ')
    logger.info(`开始更新: ${shell}`)

    const { error } = await exec(shell)
    if (error) {
      Object.keys(state).forEach(name => {
        result.push(`[${name}][更新失败] 请尝试手动更新 pnpm up ${name}@${state[name].remote}`)
      })

      result.unshift(`[更新失败] 更新数量: ${result.length}`)
      logger.error(result.join('\n'))
      logger.error(error)
      return result.join('\n')
    }

    const updatedPkg = await getPkg(true)

    Object.keys(state).forEach(name => {
      const updatedVersion = updatedPkg.dependencies?.[name] || updatedPkg.devDependencies?.[name] || updatedPkg.peerDependencies?.[name]
      if (updatedVersion !== state[name].remote) {
        result.push(`[${name}][更新失败] 请尝试手动更新 pnpm up ${name}@${state[name].remote}`)
      } else {
        result.push(`[${name}][更新成功] ${state[name].local} => ${state[name].remote}`)
      }
    })

    /** 排序 成功在上 */
    result.sort((a) => a.includes('成功') ? -1 : 1)
    logger.info(result.join('\n'))
    return result.join('\n')
  } catch (error) {
    logger.error(error)
    return (error as Error).message || '更新失败，请查看日志'
  }
}

/**
 * @description 检查git插件是否有更新
 * @param filePath 插件路径
 * @param time 任务执行超时时间 默认120s
 */
export const checkGitPluginUpdate = async (
  filePath: string,
  time = 120
): Promise<{
  /** 存在更新 */
  status: 'yes',
  /** 更新内容 */
  data: string,
  /** 落后次数 */
  count: number
} | {
  /** 无更新 */
  status: 'no'
  /** 最后更新时间描述 */
  data: string
} | {
  /** 检查发生错误 */
  status: 'error',
  data: Error
}> => {
  const logger = global?.logger || console
  try {
    /** 检查一下路径是否存在 */
    if (!fs.existsSync(filePath)) return { status: 'error', data: new Error('路径不存在') }
    /** 检查是否有.git文件夹 */
    if (!fs.existsSync(`${filePath}/.git`)) return { status: 'error', data: new Error('该路径不是一个git仓库') }

    /** 设置超时时间 */
    const timer = setTimeout(() => {
      return { status: 'failed', data: '执行超时' }
    }, time * 1000)

    const options = { cwd: filePath }

    /** git fetch origin */
    const { error } = await exec('git fetch origin', options)
    if (error) return { status: 'error', data: error }

    /** git status -uno */
    const { stdout } = await exec('git status -uno', options)
    clearTimeout(timer)

    /** 检查是否有更新 没更新直接返回 */
    if (stdout.includes('Your branch is up to date with')) {
      /** 获取最后一次提交时间 */
      const time = await getTime(filePath)
      return { status: 'no', data: `当前版本已是最新版本\n最后更新时间：${time}` }
    }

    /** 获取落后几次更新 */
    const count = Number(stdout.match(/Your branch is behind '.*' by (\d+) commits/)?.[1]) || 1
    const data = await getCommit({ path: filePath, count, branch: 'origin' })
    clearTimeout(timer)
    return { status: 'yes', data, count }
  } catch (error) {
    logger.error(error)
    return { status: 'error', data: error as Error }
  }
}

/**
 * @description 获取指定仓库的提交记录
 * @param options 参数
 * @returns 提交记录
 */
export const getCommit = async (options: {
  /** 指令命令路径 */
  path: string
  /** 获取几次提交 默认1次 */
  count?: number
  /** 指定哈希 */
  hash?: string
  /** 指定分支 */
  branch?: string
}) => {
  const { path, count = 1, hash, branch } = options
  let cmd = `git log -${count} --format="[%ad]%s %n" --date="format:%m-%d %H:%M"`
  /** 键入HEAD */
  if (hash) cmd = `git log ${hash}..HEAD --format="[%ad] %s %n" --date="format:%m-%d %H:%M"`
  /** 指定分支 */
  if (branch) cmd = `git log -${count} ${branch} --format="[%ad] %s %n" --date="format:%m-%d %H:%M"`
  const { stdout, error } = await exec(cmd, { cwd: path })
  if (error) {
    throw error
  }

  return stdout
}

/**
 * @description 获取指定仓库最后一次提交哈希值
 * @param filePath - 插件相对路径
 * @param short - 是否获取短哈希 默认true
 */
export const getHash = async (filePath: string, short = true): Promise<string> => {
  const cmd = short ? 'git rev-parse --short HEAD' : 'git rev-parse HEAD'
  const { stdout, error } = await exec(cmd, { cwd: filePath })
  if (error) {
    throw error
  }
  return stdout
}

/**
 * 获取指定仓库最后一次提交时间日期
 * @param filePath - 插件相对路径
 * @returns 最后一次提交时间
 * @example
 * ```ts
 * console.log(await getTime('./plugins/karin-plugin-example'))
 * // -> '2021-09-01 12:00:00'
 * ```
 */
export const getTime = async (filePath: string) => {
  const cmd = 'git log -1 --format=%cd --date=format:"%Y-%m-%d %H:%M:%S"'
  const { stdout, error } = await exec(cmd, { cwd: filePath })
  if (error) return '获取最后一次提交时间失败，请重试或更新Git~'
  return stdout
}

/**
 * @description 更新指定git插件
 * @param filePath 插件路径
 * @param cmd 执行命令 默认`git pull`
 * @param time 任务执行超时时间 默认120s
 */
export const updateGitPlugin = async (
  filePath: string,
  cmd = 'git pull',
  time = 120
): Promise<{
  /** 更新失败 */
  status: 'failed',
  /** 更新失败信息 */
  data: string | ExecException
} | {
  /** 更新成功 */
  status: 'ok',
  /** 更新成功信息 */
  data: string
  /** 更新详情 */
  commit: string
} | {
  /** 检查发生错误 */
  status: 'error',
  data: Error
}> => {
  const logger = global?.logger || console
  try {
    /** 检查一下路径是否存在 */
    if (!fs.existsSync(filePath)) return { status: 'failed', data: '路径不存在' }
    /** 检查是否有.git文件夹 */
    if (!fs.existsSync(`${filePath}/.git`)) return { status: 'failed', data: '该路径不是一个git仓库' }

    /** 设置超时时间 */
    const timer = setTimeout(() => {
      return { status: 'failed', data: '执行超时' }
    }, time * 1000)

    /** 记录当前短哈希 */
    const hash = await getHash(filePath)

    cmd = cmd || 'git pull'
    const { error } = await exec(cmd, { cwd: filePath })

    if (error) {
      const data = `\n更新失败\n错误信息：${error?.stack || error?.message}\n请解决错误后重试或执行【#强制更新】`
      clearTimeout(timer)
      return { status: 'failed', data }
    }

    /** 获取更新后的短哈希 */
    const updatedHash = await getHash(filePath)
    if (hash === updatedHash) {
      clearTimeout(timer)
      const commit = await getCommit({ path: filePath, count: 1 })
      return { status: 'failed', data: `\n当前版本已是最新版本\n最后更新时间：${time}\n更新详情：${commit}` }
    }

    clearTimeout(timer)
    const commit = await getCommit({ path: filePath, count: 1 })
    return { status: 'ok', data: `\n更新成功\n更新日志：${getCommit({ path: filePath, count: 1 })}`, commit }
  } catch (error) {
    logger.error(error)
    return { status: 'failed', data: error as Error }
  }
}

/**
 * @description 更新所有git插件
 * @param time 任务执行超时时间 默认120s
 */
export const updateAllGitPlugin = async (cmd = 'git pull', time = 120): Promise<string> => {
  try {
    const logger = global?.logger || console
    const list = await getPlugins('git', false)
    const tips = ['\n------- 更新git插件 --------']
    if (!list.length) {
      tips.push('没有可更新的插件~')
      tips.push('----------------------------')
      logger.info(tips.join('\n'))
      return '没有可更新的插件~'
    }
    const result: string[] = []
    await Promise.allSettled(list.map(async (name) => {
      name = name.replace('git:', '')
      const filePath = `./plugins/${name}`
      const { status, data } = await updateGitPlugin(filePath, cmd, time)
      if (status === 'ok') {
        tips.push(`[${name}][更新成功] ${data}`)
        result.push(`[${name}][更新成功] ${data}`)
      } else {
        tips.push(`[${name}][更新失败] ${data}`)
        result.push(`[${name}][更新失败] ${data}`)
      }
    }))

    tips.push('----------------------------')
    logger.info(tips.join('\n'))
    return result.join('\n')
  } catch (error) {
    logger.error(error)
    return (error as Error).message || '更新失败，请查看日志'
  }
}
