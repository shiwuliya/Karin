import { toast } from 'react-hot-toast'
import { Chip } from '@heroui/chip'
import { Button } from '@heroui/button'
import { Input } from '@heroui/input'
import { Divider } from '@heroui/divider'
import { Spinner } from '@heroui/spinner'
import { Card, CardBody } from '@heroui/card'
import { Radio, RadioGroup } from '@heroui/radio'
import { useState, useCallback, useEffect } from 'react'
import TaskLogModal from './TaskLogModal'
import { manageDependencies } from '@/request/dependencies'
import { getErrorMessage, raceRequest } from '@/request/base'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/modal'
import { LuSearch, LuPackage, LuPlus, LuChevronLeft, LuChevronRight, LuX } from 'react-icons/lu'
import type { AddDependenciesParams } from 'node-karin'

interface InstallDependencyModalProps {
  /** 模态框是否打开 */
  isOpen: boolean
  /** 关闭模态框的回调 */
  onClose: () => void
  /** 安装依赖成功回调，用于刷新依赖列表 */
  onSuccess?: () => void
}

/**
 * 传入一个npm包名，返回所有版本
 * @param packageName 包名
 * @returns 按发布时间排序的所有版本
 */
const getNpmVersions = async (packageName: string): Promise<string[]> => {
  const response = await raceRequest<Record<string, any>>([
    `https://registry.npmmirror.com/${packageName}`,
    `https://registry.npmjs.com/${packageName}`,
    `https://mirrors.cloud.tencent.com/npm/${packageName}`,
  ], {
    method: 'GET',
    timeout: 5000,
  })

  if (response?.status !== 200) return []

  /** Object.keys会乱序 */
  if (response.data.time) {
    return Object.keys(response.data.time)
      .filter(key => key !== 'created' && key !== 'modified' && response.data.versions[key])
      .sort((a, b) => {
        return new Date(response.data.time[b]).getTime() - new Date(response.data.time[a]).getTime()
      })
  }

  return Object.keys(response.data.versions)
}

/**
 * 安装依赖模态框组件
 */
const InstallDependencyModal = ({
  isOpen,
  onClose,
  onSuccess,
}: InstallDependencyModalProps) => {
  /** 输入的包名 */
  const [packageName, setPackageName] = useState('')
  /** 输入的自定义版本 */
  const [customVersion, setCustomVersion] = useState('')
  /** 选中的版本 */
  const [selectedVersion, setSelectedVersion] = useState('')
  /** 可用版本列表 */
  const [versions, setVersions] = useState<string[]>([])
  /** 版本筛选关键词 */
  const [versionFilter, setVersionFilter] = useState('')
  /** 当前页码 */
  const [currentPage, setCurrentPage] = useState(1)
  /** 查询loading状态 */
  const [isLoading, setIsLoading] = useState(false)
  /** 是否已查询过 */
  const [hasSearched, setHasSearched] = useState(false)
  /** 依赖安装位置 */
  const [location, setLocation] = useState<'dependencies' | 'devDependencies' | 'optionalDependencies'>('dependencies')
  /** 日志模态框是否打开 */
  const [isLogModalOpen, setIsLogModalOpen] = useState(false)
  /** 任务ID */
  const [taskId, setTaskId] = useState<string>('')
  /** 初始日志 */
  const [initialLogs, setInitialLogs] = useState<string[]>([])
  /** 安装中 */
  const [isInstalling, setIsInstalling] = useState(false)
  /** 允许安装的包名列表 */
  const [allowBuild, setAllowBuild] = useState<string[]>([])
  /** 当前输入的包名 */
  const [currentAllowBuildInput, setCurrentAllowBuildInput] = useState('')

  /** 每页显示版本数量 */
  const versionsPerPage = 25

  /** 重置组件状态 */
  const resetState = useCallback(() => {
    setPackageName('')
    setCustomVersion('')
    setSelectedVersion('')
    setVersions([])
    setVersionFilter('')
    setCurrentPage(1)
    setIsLoading(false)
    setHasSearched(false)
    setLocation('dependencies')
    setAllowBuild([])
    setCurrentAllowBuildInput('')
  }, [])

  /** 模态框关闭时重置状态 */
  useEffect(() => {
    if (!isOpen) {
      resetState()
    }
  }, [isOpen, resetState])

  /**
   * 处理版本查询
   */
  const handleSearch = useCallback(async () => {
    if (!packageName.trim()) {
      toast.error('请输入包名')
      return
    }

    try {
      const list = await getNpmVersions(packageName.trim())
      setVersions(list)
      setSelectedVersion(list[0])
      setCustomVersion(list[0])
      setCurrentPage(1)
      setHasSearched(true)
    } catch (error) {
      toast.error('查询版本失败')
      console.error(error)
    }
  }, [packageName])

  /**
   * 处理允许安装的包名添加
   */
  const handleAddAllowBuild = useCallback(() => {
    if (!currentAllowBuildInput.trim()) return

    if (!allowBuild.includes(currentAllowBuildInput.trim())) {
      setAllowBuild([...allowBuild, currentAllowBuildInput.trim()])
    }

    setCurrentAllowBuildInput('')
  }, [currentAllowBuildInput, allowBuild])

  /**
   * 处理允许安装的包名删除
   */
  const handleRemoveAllowBuild = useCallback((packageToRemove: string) => {
    setAllowBuild(allowBuild.filter(pkg => pkg !== packageToRemove))
  }, [allowBuild])

  /**
   * 处理按键事件 - 回车添加包名
   */
  const handleAllowBuildKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddAllowBuild()
    }
  }, [handleAddAllowBuild])

  /**
   * 处理安装按钮点击
   */
  const handleInstall = useCallback(async () => {
    if (!packageName.trim()) {
      toast.error('请输入包名')
      return
    }

    /** 如果没有选择版本也没有输入自定义版本，则使用 latest */
    const version = customVersion.trim() || selectedVersion || 'latest'

    try {
      setIsInstalling(true)
      setTaskId('')
      setInitialLogs([])

      /** 构建安装参数 */
      const params: AddDependenciesParams = {
        type: 'add',
        data: {
          name: packageName.trim(),
          location,
          version,
          allowBuild,
        },
      }

      /** 初始日志 */
      const logs = [
        `开始安装依赖: ${packageName.trim()}@${version}`,
        `安装位置: ${location}`,
        '正在创建任务...',
      ]

      /** 发起请求 */
      const response = await manageDependencies(params)

      if (!response.success || !response.data || !response.data.success) {
        console.error('安装依赖失败:', response.data)
        toast.error(`安装依赖失败: ${(response.data as Error).message || '未知错误'}`)
        return
      }

      /** 设置任务信息 */
      setTaskId(response.data.taskId)
      setInitialLogs([
        ...logs,
        '任务创建成功!',
        `任务ID: ${response.data.taskId}`,
        '正在连接任务执行日志...',
      ])

      /** 打开日志模态框 */
      setIsLogModalOpen(true)

      /** 关闭安装模态框 */
      onClose()

      /** 安装成功后刷新依赖列表 */
      if (onSuccess) {
        setTimeout(onSuccess, 500)
      }
    } catch (error) {
      console.error('安装依赖失败:', error)
      toast.error(`安装依赖失败: ${getErrorMessage(error)}`)
    } finally {
      setIsInstalling(false)
    }
  }, [packageName, customVersion, selectedVersion, location, onClose, onSuccess, allowBuild])

  /**
   * 处理版本选择
   */
  const handleVersionSelect = useCallback((version: string) => {
    if (selectedVersion === version) {
      setSelectedVersion('')
      setCustomVersion('')
    } else {
      setSelectedVersion(version)
      setCustomVersion(version)
    }
  }, [selectedVersion])

  /**
   * 获取过滤后的版本列表
   */
  const getFilteredVersions = useCallback(() => {
    if (!versionFilter) {
      return versions
    }

    return versions.filter(v => v.includes(versionFilter))
  }, [versions, versionFilter])

  /** 过滤后的版本列表 */
  const filteredVersions = getFilteredVersions()

  /** 计算总页数 */
  const totalPages = Math.ceil(filteredVersions.length / versionsPerPage)

  /** 当前页的版本列表 */
  const currentVersions = filteredVersions.slice(
    (currentPage - 1) * versionsPerPage,
    currentPage * versionsPerPage
  )

  /** 处理页码变更 */
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }, [totalPages])

  /** 处理日志模态框关闭 */
  const handleLogModalClose = useCallback(() => {
    setIsLogModalOpen(false)
    setTaskId('')
    setInitialLogs([])
    if (onSuccess) {
      onSuccess()
    }
  }, [onSuccess])

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        backdrop='blur'
        radius='lg'
        placement='center'
        classNames={{
          base: 'border border-default-100 max-w-md mx-auto my-0',
          wrapper: 'items-center justify-center',
          header: 'border-b border-default-100 p-4',
          body: 'p-4',
          footer: 'border-t border-default-100 p-4',
          closeButton: 'hover:bg-default-100',
        }}
        size='md'
      >
        <ModalContent>
          <ModalHeader className='flex flex-col gap-1 pb-3'>
            <div className='flex items-center gap-2'>
              <LuPackage size={20} className='text-primary-500' />
              <div className='text-lg font-light tracking-tight'>安装新的依赖</div>
            </div>
          </ModalHeader>

          <Divider className='opacity-50' />

          <ModalBody className='py-3'>
            <div className='space-y-4'>
              {/* 包名输入 */}
              <div>
                <label className='block text-sm text-default-700 mb-1'>包名称</label>
                <div className='flex gap-2'>
                  <Input
                    placeholder='输入npm包名称，例如：lodash'
                    value={packageName}
                    onChange={(e) => setPackageName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    size='sm'
                    color='primary'
                    className='font-light flex-1 h-10'
                  />
                  <Button
                    color='primary'
                    size='sm'
                    radius='md'
                    isLoading={isLoading}
                    startContent={!isLoading && <LuSearch size={16} />}
                    onPress={handleSearch}
                  >
                    查询版本
                  </Button>
                </div>
              </div>

              {/* 自定义版本输入 */}
              <div>
                <label className='block text-sm text-default-700 mb-1'>版本</label>
                <Input
                  placeholder='输入版本号，例如：1.0.0，留空使用最新版本'
                  value={customVersion}
                  onChange={(e) => setCustomVersion(e.target.value)}
                  size='sm'
                  color='primary'
                  className='font-light h-10'
                />
              </div>
              {/* 允许pnpm在安装期间执行安装的包名列表 */}
              <div>
                <label className='block text-sm text-default-700 mb-1'>允许pnpm在安装期间执行安装的包名列表</label>
                <div className='flex gap-2'>
                  <Input
                    placeholder='输入包名，例如：lodash'
                    value={currentAllowBuildInput}
                    onChange={(e) => setCurrentAllowBuildInput(e.target.value)}
                    onKeyDown={handleAllowBuildKeyDown}
                    size='sm'
                    color='primary'
                    className='font-light flex-1 h-10'
                  />
                  <Button
                    color='primary'
                    size='sm'
                    radius='md'
                    onPress={handleAddAllowBuild}
                    startContent={<LuPlus size={16} />}
                    isDisabled={!currentAllowBuildInput.trim()}
                  >
                    添加
                  </Button>
                </div>
                {allowBuild.length > 0 && (
                  <div className='flex flex-wrap gap-1 mt-2'>
                    {allowBuild.map((pkg) => (
                      <Chip
                        key={pkg}
                        variant='flat'
                        color='primary'
                        size='sm'
                        radius='sm'
                        onClose={() => handleRemoveAllowBuild(pkg)}
                        className='text-xs'
                      >
                        {pkg}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>

              {/* 依赖安装位置 */}
              <div>
                <label className='block text-sm text-default-700 mb-1'>安装位置</label>
                <RadioGroup
                  value={location}
                  onValueChange={(value) => setLocation(value as 'dependencies' | 'devDependencies' | 'optionalDependencies')}
                  orientation='vertical'
                  size='sm'
                  className='space-y-2'
                >
                  <Radio value='dependencies'>dependencies</Radio>
                  <Radio value='devDependencies'>devDependencies</Radio>
                  <Radio value='optionalDependencies'>optionalDependencies</Radio>
                </RadioGroup>
              </div>

              {/* 版本列表卡片 */}
              {hasSearched && (
                <Card className='shadow-sm'>
                  <CardBody className='p-3'>
                    {isLoading
                      ? (
                        <div className='flex items-center justify-center py-8'>
                          <Spinner size='sm' color='primary' />
                          <span className='ml-2 text-sm text-default-600'>正在获取版本信息...</span>
                        </div>)
                      : versions.length > 0
                        ? (
                          <>
                            <div className='mb-3'>
                              <div className='flex justify-between items-center mb-2'>
                                <div className='text-sm font-medium'>
                                  可用版本{filteredVersions.length > 0 ? `(${filteredVersions.length}个)` : ''}
                                </div>
                                {selectedVersion && (
                                  <div className='flex items-center gap-1 text-xs bg-primary-50 text-primary-600 px-2 py-1 rounded-md'>
                                    <span>已选择: {selectedVersion}</span>
                                    <Button
                                      isIconOnly
                                      size='sm'
                                      variant='light'
                                      onPress={() => {
                                        setSelectedVersion('')
                                        setCustomVersion('')
                                      }}
                                      className='h-4 w-4 min-w-0 p-0'
                                    >
                                      <LuX size={12} />
                                    </Button>
                                  </div>
                                )}
                              </div>

                              <Input
                                aria-label='过滤版本'
                                placeholder='输入关键词过滤版本...'
                                value={versionFilter}
                                onChange={(e) => {
                                  setVersionFilter(e.target.value)
                                  setCurrentPage(1)
                                }}
                                size='sm'
                                color='primary'
                                startContent={<LuSearch size={16} className='text-primary-400' />}
                                className='font-light h-10'
                              />
                            </div>

                            <div className='mt-4'>
                              <div className='grid grid-cols-5 gap-x-1 gap-y-0 h-[185px] overflow-y-auto'>
                                {currentVersions.length > 0
                                  ? (currentVersions.map((version) => (
                                    <Chip
                                      key={version}
                                      variant={selectedVersion === version ? 'solid' : 'flat'}
                                      color={selectedVersion === version ? 'primary' : 'default'}
                                      className='cursor-pointer font-mono text-xs my-0.5 flex justify-center'
                                      size='sm'
                                      radius='sm'
                                      onClick={() => handleVersionSelect(version)}
                                    >
                                      {version}
                                    </Chip>)))
                                  : (
                                    <div className='text-xs text-default-500 py-2'>
                                      未找到匹配的版本
                                    </div>)}
                              </div>
                            </div>

                            {/* 分页控制 */}
                            {totalPages > 1 && (
                              <div className='flex items-center justify-center gap-2 mt-2'>
                                <Button
                                  isIconOnly
                                  size='sm'
                                  variant='flat'
                                  onPress={() => handlePageChange(currentPage - 1)}
                                  isDisabled={currentPage <= 1}
                                  className='min-w-8 h-8'
                                >
                                  <LuChevronLeft size={16} />
                                </Button>

                                <span className='text-sm text-default-600'>
                                  {currentPage}/{totalPages}
                                </span>

                                <Button
                                  isIconOnly
                                  size='sm'
                                  variant='flat'
                                  onPress={() => handlePageChange(currentPage + 1)}
                                  isDisabled={currentPage >= totalPages}
                                  className='min-w-8 h-8'
                                >
                                  <LuChevronRight size={16} />
                                </Button>
                              </div>
                            )}

                            {versionFilter && (
                              <div className='mt-1 text-xs text-default-500 text-center'>
                                已按 "{versionFilter}" 筛选
                              </div>
                            )}
                          </>)
                        : (
                          <div className='text-center py-8 text-default-500'>
                            <div className='text-sm'>未找到版本信息</div>
                            <div className='text-xs mt-1'>请检查包名称是否正确</div>
                          </div>)}
                  </CardBody>
                </Card>
              )}
            </div>
          </ModalBody>

          <Divider className='opacity-50' />

          <ModalFooter>
            <Button
              color='default'
              variant='light'
              onPress={onClose}
              radius='full'
              className='font-normal text-xs md:text-sm'
              size='sm'
            >
              取消
            </Button>
            <Button
              color='primary'
              onPress={handleInstall}
              radius='full'
              className='font-normal text-xs md:text-sm'
              size='sm'
              startContent={<LuPlus size={16} />}
              isDisabled={!packageName.trim() || isInstalling}
              isLoading={isInstalling}
            >
              安装依赖
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 任务日志模态框 */}
      <TaskLogModal
        isOpen={isLogModalOpen}
        onClose={handleLogModalClose}
        taskId={taskId}
        taskName={`安装依赖: ${packageName}`}
        initialLogs={initialLogs}
      />
    </>
  )
}

export default InstallDependencyModal
