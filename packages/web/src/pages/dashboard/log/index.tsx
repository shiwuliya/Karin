import '@xterm/xterm/css/xterm.css'
import { Card } from '@heroui/card'
import { Terminal } from '@xterm/xterm'
import { parseLogLine } from './parse'
import { Button } from '@heroui/button'
import { Tabs, Tab } from '@heroui/tabs'
import { FitAddon } from '@xterm/addon-fit'
import { useEffect, useState, useRef } from 'react'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { eventSourcePolyfill, request } from '@/lib/request'
import { StreamDownloader } from '@/components/StreamDownloader'
import { IoChevronDown as MoreVerticalIcon } from 'react-icons/io5'
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@heroui/dropdown'

import type { Key } from 'react'
import type { FilterLevel, LogItem, LogLevel } from '@/types/log'

const color = {
  trac: {
    color: 'primary',
    name: 'TRACE',
  },
  debu: {
    color: 'primary',
    name: 'DEBUG',
  },
  info: {
    color: 'success',
    name: 'INFO',
  },
  warn: {
    color: 'warning',
    name: 'WARN',
  },
  erro: {
    color: 'danger',
    name: 'ERROR',
  },
  fata: {
    color: 'secondary',
    name: 'FATAL',
  },
  mark: {
    color: 'default',
    name: 'MARK',
  },
} as const

const LOG_LEVELS = Object.keys(color) as LogLevel[]

/**
 * 最大日志行数
 */
const DEFAULT_MAX_LOG_LINES = 3000

/**
 * 批量处理大小
 */
const BATCH_SIZE = 50

/**
 * 创建终端
 * @returns 终端实例
 */
const createTerminal = (isMobile = false) => {
  const terminal = new Terminal({
    fontSize: isMobile ? 8 : 14,
    fontFamily: 'Consolas, "DejaVu Sans Mono", "Courier New", monospace',
    lineHeight: 1.1,
    theme: {
      background: '#1a1a1a',
      foreground: '#f0f0f0',
      selectionBackground: '#3b3b3b',
      cursor: '#f0f0f0',
    },
    convertEol: true,
    cursorBlink: false,
    disableStdin: false,
    scrollback: 3000,
    cols: 999, // 设置一个较大的列数，让终端充分利用可用宽度
    letterSpacing: 0,
  })

  return terminal
}

/**
 * 创建日志流
 * @returns 日志流实例
 */
const createEventSource = () => {
  return eventSourcePolyfill('/api/v1/log', {
    withCredentials: true,
    heartbeatTimeout: 60000,
  })
}

export default function LogPage () {
  /** 日志行数限制 */
  const [maxLogLines, setMaxLogLines] = useState(DEFAULT_MAX_LOG_LINES)
  /** 当前过滤等级 */
  const [selectedLevel, setSelectedLevel] = useState<FilterLevel>('all')
  /** 终端容器 */
  const terminalRef = useRef<HTMLDivElement>(null)
  /** 终端实例 */
  const terminalInstance = useRef<Terminal | null>(null)
  /** 日志流 */
  const eventSourceRef = useRef<EventSource | null>(null)
  /** 日志列表 */
  const logsRef = useRef<LogItem[]>([])
  /** 日志文件列表 */
  const [logFiles, setLogFiles] = useState<string[]>([])
  /** 选中的日志文件 */
  const [selectedFile, setSelectedFile] = useState<string>('')
  const isMobile = useMediaQuery('(max-width: 768px)')
  const [selectedTab, setSelectedTab] = useState('realtime')
  /** 历史日志内容 */
  const [historyLogs, setHistoryLogs] = useState<LogItem[]>([])
  /** 日志缓冲区 */
  const logBufferRef = useRef<LogItem[]>([])
  /** 动画帧ID */
  const animationFrameRef = useRef<number | null>(null)
  /** 是否需要滚动到底部 */
  const shouldScrollRef = useRef(true)
  /** 是否在底部 */
  const [isAtBottom, setIsAtBottom] = useState(true)
  /** 滚动自动触发的阈值（底部百分比） */
  const AUTO_SCROLL_THRESHOLD = 0.1 // 10%

  /**
   * 检查是否在底部区域
   * @param terminal 终端实例
   * @returns 是否在底部区域
   */
  const isNearBottom = (terminal: Terminal) => {
    const totalLines = terminal.buffer.active.length
    const viewportY = terminal.buffer.active.viewportY
    const visibleLines = terminal.rows

    // 如果总行数不足以填满视口，则认为在底部
    if (totalLines <= visibleLines) {
      return true
    }

    // 计算当前滚动位置到底部的距离占整个内容的百分比
    const distanceFromBottom = (totalLines - viewportY - visibleLines) / totalLines

    // 如果在底部AUTO_SCROLL_THRESHOLD(10%)范围内，则认为在底部区域
    return distanceFromBottom <= AUTO_SCROLL_THRESHOLD
  }

  /**
   * 滚动到底部
   */
  const scrollToBottom = () => {
    if (terminalInstance.current && shouldScrollRef.current) {
      terminalInstance.current.scrollToBottom()
    }
  }

  /**
   * 强制滚动到底部并重新启用自动滚动
   */
  const forceScrollToBottom = () => {
    if (terminalInstance.current) {
      shouldScrollRef.current = true
      setIsAtBottom(true)
      terminalInstance.current.scrollToBottom()
    }
  }

  /**
   * 批量写入日志到终端
   */
  const flushLogBuffer = () => {
    if (logBufferRef.current.length === 0 || !terminalInstance.current) return

    const buffer = logBufferRef.current
    logBufferRef.current = []

    const filteredLogs = buffer.filter(
      log => selectedLevel === 'all' || log.level === selectedLevel
    )

    if (filteredLogs.length === 0) return

    // 检查当前是否在底部区域
    const wasNearBottom = isNearBottom(terminalInstance.current)

    // 使用writeSync批量写入，减少重绘
    const content = filteredLogs.map(log => log.message).join('\r\n') + '\r\n'
    terminalInstance.current.write(content)

    // 只有当之前在底部区域时才滚动到底部
    if (wasNearBottom) {
      terminalInstance.current.scrollToBottom()
    }
  }

  /**
   * 设置日志流
   */
  const setEventSource = () => {
    /** 创建日志流 */
    const eventSource = createEventSource()
    /** 设置日志流 */
    eventSourceRef.current = eventSource
    /** 监听日志流 */
    eventSource.onmessage = (event) => {
      /** 解析日志行 */
      const logItem = parseLogLine(event.data)
      if (!logItem) return

      /** 添加日志行 */
      logsRef.current.push(logItem)

      /** 限制日志行数 */
      if (logsRef.current.length > maxLogLines) {
        // 如果超出限制，清除最早的日志
        const excessCount = logsRef.current.length - maxLogLines
        logsRef.current = logsRef.current.slice(excessCount)

        // 如果终端行数也超过限制，清空终端并重新写入
        if (terminalInstance.current && terminalInstance.current.buffer.active.length > maxLogLines) {
          terminalInstance.current.clear()
          const filteredLogs = logsRef.current.filter(
            log => selectedLevel === 'all' || log.level === selectedLevel
          )

          // 分批次写入日志，减少终端闪烁
          const batchCount = Math.ceil(filteredLogs.length / BATCH_SIZE)
          for (let i = 0; i < batchCount; i++) {
            const batch = filteredLogs.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
            const content = batch.map(log => log.message).join('\r\n') + '\r\n'
            terminalInstance.current.write(content)
          }
        }
      }

      // 将日志放入缓冲区，不立即渲染
      logBufferRef.current.push(logItem)

      // 使用requestAnimationFrame防止频繁渲染导致闪烁
      if (animationFrameRef.current === null) {
        animationFrameRef.current = requestAnimationFrame(() => {
          flushLogBuffer()
          animationFrameRef.current = null
        })
      }
    }

    eventSource.onerror = (error) => {
      console.error('日志连接出错:', error)
    }
  }

  useEffect(() => {
    if (!terminalRef.current) return

    /** 创建终端 */
    const terminal = createTerminal(isMobile)
    /** 创建终端适配器 */
    const fitAddon = new FitAddon()
    /** 加载终端适配器 */
    terminal.loadAddon(fitAddon)
    /** 加载终端链接适配器 */
    terminal.loadAddon(new WebLinksAddon())
    /** 打开终端 */
    terminal.open(terminalRef.current)
    /** 调整终端大小 */
    fitAddon.fit()
    /** 设置终端实例 */
    terminalInstance.current = terminal

    /** 创建终端大小观察器 */
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      // 重新调整大小后滚动到底部
      setTimeout(scrollToBottom, 0)
    })

    /** 观察终端大小变化 */
    resizeObserver.observe(terminalRef.current)

    // 监听终端滚动
    terminal.onScroll(() => {
      // 使用新方法检查是否在底部区域
      const currentIsAtBottom = isNearBottom(terminal)

      // 只有当状态发生变化时才更新
      if (currentIsAtBottom !== isAtBottom) {
        setIsAtBottom(currentIsAtBottom)
        // 更新自动滚动标志
        shouldScrollRef.current = currentIsAtBottom
      }
    })

    // 优化移动端显示
    const optimizeForMobile = () => {
      const currentIsMobile = window.matchMedia('(max-width: 768px)').matches

      if (currentIsMobile) {
        // 移动端下调整字体大小使内容更紧凑
        terminal.options.fontSize = 8
        terminal.options.letterSpacing = 0
      } else {
        terminal.options.fontSize = 14
        terminal.options.letterSpacing = 0
      }
      // 应用新设置
      fitAddon.fit()

      // 滚动到底部
      setTimeout(scrollToBottom, 0)
    }

    // 窗口大小变化时重新优化
    window.addEventListener('resize', optimizeForMobile)

    /** 清理终端 */
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      resizeObserver.disconnect()
      window.removeEventListener('resize', optimizeForMobile)
      terminal.dispose()
    }
  }, [isMobile])

  useEffect(() => {
    try {
      /** 连接日志流 */
      setEventSource()
    } catch (error) {
      console.error('日志获取失败:', error)
    }
    return () => {
      eventSourceRef?.current?.close()
    }
  }, [])

  /** 处理日志等级切换 */
  useEffect(() => {
    if (!terminalInstance.current) return

    terminalInstance.current.clear()
    const filteredLogs = selectedLevel === 'all'
      ? logsRef.current
      : logsRef.current.filter(log => log.level === selectedLevel)

    // 分批次写入日志，减少终端闪烁
    const batchCount = Math.ceil(filteredLogs.length / BATCH_SIZE)
    for (let i = 0; i < batchCount; i++) {
      const batch = filteredLogs.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
      const content = batch.map(log => log.message).join('\r\n') + '\r\n'
      terminalInstance.current.write(content)
    }

    // 重置滚动状态并滚动到底部
    shouldScrollRef.current = true
    setIsAtBottom(true)
    setTimeout(scrollToBottom, 0)
  }, [selectedLevel])

  /**
   * 获取历史日志
   * @param file 日志文件
   */
  const fetchHistoryLog = async (file: string) => {
    if (!file) return
    setMaxLogLines(3000)
    const content = await request.serverGet<string>(`/api/v1/logs/file?file=${file}`)

    if (terminalInstance.current) {
      terminalInstance.current.clear()
      const logs: LogItem[] = []

      content.split('\n').forEach(line => {
        const logItem = parseLogLine(line)
        if (!logItem) return
        logs.push(logItem)
      })

      // 保留最新的3000条日志
      const trimmedLogs = logs.length > maxLogLines ? logs.slice(-maxLogLines) : logs

      setHistoryLogs(trimmedLogs)

      // 过滤并分批写入终端
      const filteredLogs = trimmedLogs.filter(
        log => selectedLevel === 'all' || log.level === selectedLevel
      )

      const batchCount = Math.ceil(filteredLogs.length / BATCH_SIZE)
      for (let i = 0; i < batchCount; i++) {
        const batch = filteredLogs.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
        const content = batch.map(log => log.message).join('\r\n') + '\r\n'
        terminalInstance.current.write(content)
      }

      // 滚动到底部
      setTimeout(scrollToBottom, 0)
    }
  }

  /**
   * 写入日志
   * @param writer 写入器
   */
  const handleWrite = async (writer: WritableStreamDefaultWriter<Uint8Array>) => {
    const encoder = new TextEncoder()
    // 根据当前标签页选择要下载的日志
    const logsToWrite = selectedTab === 'realtime' ? logsRef.current : historyLogs
    const logs = selectedLevel === 'all'
      ? logsToWrite
      : logsToWrite.filter(log => log.level === selectedLevel)

    const total = logs.length
    const batchSize = 1000

    for (let i = 0; i < total; i += batchSize) {
      const batch = logs.slice(i, i + batchSize)
      const content = batch
        .map(log => log.message)
        .join('\n') + '\n'

      await writer.write(encoder.encode(content))
    }
  }

  /** 获取日志文件列表 */
  const fetchLogFiles = async () => {
    const res = await request.serverGet<string[]>('/api/v1/logs/list')
    setLogFiles(res)
    if (res.length > 0) {
      setSelectedFile(res[0])
    }
  }

  /** 移动端 */
  const showMobileButtons = () => {
    return (
      <>
        <Button
          size='sm'
          variant='flat'
          color='danger'
          onPress={() => setSelectedLevel('erro')}
        >
          {color.erro.name}
        </Button>
        <Dropdown>
          <DropdownTrigger>
            <Button
              size='sm'
              variant='flat'
              color='success'
            >
              更多
              <MoreVerticalIcon className='w-3.5 h-3.5 ml-1' />
            </Button>
          </DropdownTrigger>
          <DropdownMenu
            className='min-w-[120px]'
          >
            {LOG_LEVELS.map(level => {
              if (level === 'erro') return null
              return (
                <DropdownItem
                  key={level}
                  className='data-[hover=true]:bg-default-100'
                  onPress={() => setSelectedLevel(level)}
                >
                  <div className='flex items-center gap-2'>
                    <div className={`w-2 h-2 rounded-full bg-${color[level].color}`} />
                    {color[level].name}
                  </div>
                </DropdownItem>
              )
            })}
          </DropdownMenu>
        </Dropdown>
      </>
    )
  }

  /** pc端 */
  const showPcButtons = () => {
    return LOG_LEVELS.map(level => {
      if (level === 'trac') {
        return (
          <Button
            key={level}
            size='sm'
            variant='flat'
            className='bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300'
            onPress={() => setSelectedLevel(level)}
          >
            {color[level].name}
          </Button>
        )
      }

      return (
        <Button
          key={level}
          size='sm'
          variant='flat'
          color={color[level].color}
          onPress={() => setSelectedLevel(level)}
        >
          {color[level].name}
        </Button>
      )
    })
  }

  /** 处理标签切换 */
  const handleTabChange = (key: Key) => {
    setSelectedTab(key as string)
    if (key === 'realtime') {
      setMaxLogLines(DEFAULT_MAX_LOG_LINES)
      // 重新显示实时日志...
      if (terminalInstance.current) {
        terminalInstance.current.clear()

        // 确保实时日志数量不超过限制
        if (logsRef.current.length > DEFAULT_MAX_LOG_LINES) {
          logsRef.current = logsRef.current.slice(-DEFAULT_MAX_LOG_LINES)
        }

        const filteredLogs = selectedLevel === 'all'
          ? logsRef.current
          : logsRef.current.filter(log => log.level === selectedLevel)

        // 分批写入日志
        const batchCount = Math.ceil(filteredLogs.length / BATCH_SIZE)
        for (let i = 0; i < batchCount; i++) {
          const batch = filteredLogs.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
          const content = batch.map(log => log.message).join('\r\n') + '\r\n'
          terminalInstance.current.write(content)
        }

        // 滚动到底部
        setTimeout(scrollToBottom, 0)
      }
    } else {
      // 获取历史日志文件列表
      fetchLogFiles()
    }
  }

  return (
    <div className='space-y-6'>
      {/* 标签页卡片 */}
      <Card className='w-full border border-gray-200 dark:border-gray-700 shadow-lg rounded-lg overflow-hidden'>
        <div className='p-4'>
          <div className='flex flex-col md:flex-row md:items-center gap-4'>
            <div className='flex-shrink-0'>
              <Tabs
                selectedKey={selectedTab}
                onSelectionChange={handleTabChange}
                size='sm'
                className='min-w-[160px]'
                classNames={{
                  tabList: 'gap-2',
                  tab: 'px-3 h-8',
                }}
              >
                <Tab key='realtime' title='实时日志' />
                <Tab key='history' title='历史日志' />
              </Tabs>
            </div>

            <div className={`flex-shrink-0 ${selectedTab === 'realtime' ? 'md:ml-auto' : ''} flex items-center gap-2`}>
              <div className='flex w-full md:w-auto gap-2'>
                {selectedTab === 'realtime' && (
                  <Button
                    size='sm'
                    variant='flat'
                    color='primary'
                    onPress={forceScrollToBottom}
                    disabled={isAtBottom}
                  >
                    滚动到最新
                  </Button>
                )}
                {selectedTab === 'history' && logFiles.length > 0 && (
                  <Dropdown className='flex-1 md:flex-initial'>
                    <DropdownTrigger>
                      <Button
                        size='sm'
                        variant='flat'
                        color='secondary'
                        className='w-full md:w-auto'
                      >
                        {selectedFile || '选择日志文件'}
                        <MoreVerticalIcon className='w-3.5 h-3.5 ml-1' />
                      </Button>
                    </DropdownTrigger>
                    <DropdownMenu
                      className='max-h-[210px] overflow-y-auto'
                    >
                      {logFiles.map(file => (
                        <DropdownItem
                          key={file}
                          onPress={() => {
                            setSelectedFile(file)
                            fetchHistoryLog(file)
                          }}
                        >
                          {file}
                        </DropdownItem>
                      ))}
                    </DropdownMenu>
                  </Dropdown>
                )}
                <div className='flex-1 md:flex-initial'>
                  <StreamDownloader
                    onWrite={handleWrite}
                    filename={`system-log-${selectedFile || new Date().toISOString().split('T')[0]}.txt`}
                    className='w-full md:w-auto'
                  >
                    下载日志
                  </StreamDownloader>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* 控制台卡片 */}
      <Card className='w-full border border-gray-200 dark:border-gray-700 shadow-lg rounded-lg overflow-hidden'>
        <div className='p-6'>
          <div className='flex gap-2 flex-wrap mb-4'>
            <Button
              size='sm'
              variant='flat'
              color='default'
              className='bg-gradient-to-r from-gray-500 to-gray-600 text-white'
              onPress={() => setSelectedLevel('all')}
            >
              全部
            </Button>
            {isMobile ? showMobileButtons() : showPcButtons()}
          </div>
          <div className='pl-3 pt-3 pr-3 bg-[#1a1a1a] rounded-lg border border-gray-200 dark:border-gray-800'>
            <div
              ref={terminalRef}
              className='h-[700px] w-full overflow-hidden'
            />
          </div>
        </div>
      </Card>
    </div>
  )
}
