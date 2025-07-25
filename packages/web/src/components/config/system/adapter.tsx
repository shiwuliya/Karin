import { useState } from 'react'
import { saveConfig } from './save'
import { Form } from '@heroui/form'
import { Input } from '@heroui/input'
import { Switch } from '@heroui/switch'
import { Tooltip } from '@heroui/tooltip'
import { Divider } from '@heroui/divider'
import { InternalAccordion } from './accordion'
import { NumberInput } from '@heroui/number-input'
import { Terminal, Bot, Network, Server } from 'lucide-react'
import { useForm, FormProvider, useFieldArray } from 'react-hook-form'

import type { Adapters } from 'node-karin'

/**
 * 获取适配器组件
 * @param data 适配器数据
 * @param formRef 表单引用，用于外部触发表单提交
 * @returns 适配器组件
 */
const getAdapterComponent = (
  data: Adapters,
  formRef: React.RefObject<HTMLFormElement | null>
) => {
  const [protocol, setProtocol] = useState(data.console.host.split('://')[0] || 'http')

  const methods = useForm({
    defaultValues: {
      // 不要用解构赋值 否则会丢失数据
      console: {
        isLocal: data.console.isLocal ?? false,
        token: data.console.token ?? '',
        host: data.console.host.replace(/(http|https):\/\//, '') ?? '',
      },
      onebot: {
        ws_server: {
          enable: data.onebot.ws_server.enable ?? false,
          timeout: data.onebot.ws_server.timeout ?? 120,
        },
        ws_client: data.onebot.ws_client ?? [],
        http_server: data.onebot.http_server ?? [],
      },
    },
  })

  const wsClientFields = useFieldArray({
    control: methods.control,
    name: 'onebot.ws_client',
  })

  const httpServerFields = useFieldArray({
    control: methods.control,
    name: 'onebot.http_server',
  })

  const isLocal = methods.watch('console.isLocal')

  const onSubmit = (formData: Adapters) => {
    const finalData = {
      ...formData,
      console: {
        ...formData.console,
        host: formData.console.host ? `${protocol}://${formData.console.host}` : '',
      },
    }
    saveConfig('adapter', finalData)
  }

  const addWsClient = () => {
    wsClientFields.append({
      enable: false,
      url: '',
      token: '',
    })
  }

  const addHttpServer = () => {
    httpServerFields.append({
      enable: false,
      self_id: 'default',
      url: '',
      token: '',
      api_token: '',
      post_token: '',
    })
  }

  return (
    <FormProvider {...methods}>
      <Form
        className='w-full max-w-full flex flex-col'
        onSubmit={methods.handleSubmit(onSubmit)}
        ref={formRef}
      >
        <div className='w-full max-w-full px-6 py-4 space-y-4'>
          <div className='text-lg font-medium flex items-center gap-2'>
            <Terminal className='w-5 h-5' />
            Console 适配器
          </div>
          <Divider className='w-full' />
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Switch
                className='p-2 rounded-lg w-[500px]'
                {...methods.register('console.isLocal')}
                defaultChecked={data.console.isLocal}
                color='success'
              >
                <div className='flex flex-col'>
                  <span className='text-sm'>只允许本地访问</span>
                  <span className='text-xs text-gray-500'>打开后 适配器生成的资源文件连接将只允许127.0.0.1访问</span>
                </div>
              </Switch>
            </div>

            <div className='grid md:grid-cols-2 grid-cols-1 gap-y-4 md:gap-x-12'>
              <Input
                label='资源文件的访问地址'
                {...methods.register('console.host')}
                description='打印的资源文件访问地址，本地模式下可留空。'
                placeholder=''
                className='p-2 rounded-lg w-full'
                color='primary'
                startContent={
                  <div className='flex items-center'>
                    <label className='sr-only' htmlFor='protocol'>
                      Protocol
                    </label>
                    <select
                      className='outline-none border-0 bg-transparent text-primary text-small'
                      id='protocol'
                      name='protocol'
                      value={protocol}
                      onChange={(e) => setProtocol(e.target.value)}
                    >
                      <option value='http' className='text-primary'>http://</option>
                      <option value='https' className='text-primary'>https://</option>
                    </select>
                  </div>
                }
              />
              <Input
                {...methods.register('console.token')}
                label='Token'
                description='用于验证连接的安全令牌，本地模式下可留空'
                placeholder='请输入 Token'
                required={!isLocal}
                isRequired={!isLocal}
                className='p-2 rounded-lg'
                color='primary'
              />
            </div>
          </div>
          <div className='text-lg font-medium flex items-center gap-2'>
            <Bot className='w-5 h-5' />
            OneBot 适配器
          </div>
          <Divider className='w-full' />
          <div className='space-y-4'>
            <div className='flex items-center justify-between'>
              <Tooltip
                content={
                  <div className='space-y-2 p-2'>
                    <p>用于接收来自OneBot11协议的 WebSocket 连接</p>
                    <p className='text-xs text-default-500 '>1.打开此项开关</p>
                    <p className='text-xs text-default-500 '>2.将会启用一个挂载在HTTP端口上的WebSocket服务器</p>
                    <p className='text-xs text-default-500 '>3.通过组合HTTP端口，可以创建一个反向链接</p>
                    <p className='text-xs text-default-500 '>4. 如HTTP端口为7777，则反向链接为 <code className='text-xs text-blue-500'>ws://127.0.0.1:7777</code></p>
                    <br />
                    <p>理解这里最简单的方法就是:</p>
                    <p className='text-xs text-default-500 '>
                      karin开启了一个WebSocket服务器，并监听7777端口
                      然后karin等着协议端来疯狂连接，俗称诶c...
                    </p>
                  </div>
                }
                placement='right'
                showArrow
                classNames={{
                  content: 'p-0',
                }}
                delay={0}
                closeDelay={0}
              >
                <Switch
                  className='p-2 rounded-lg'
                  {...methods.register('onebot.ws_server.enable')}
                  defaultChecked={data.onebot.ws_server.enable}
                  color='success'
                >
                  <div className='flex flex-col'>
                    <span className='text-xs'>反向 WebSocket 服务器</span>
                    <span className='text-xs text-gray-500'>鼠标悬停可以查看详情(〃'▽'〃)</span>
                  </div>
                </Switch>
              </Tooltip>
            </div>
            <div className='flex'>
              {/* @ts-ignore */}
              <NumberInput
                label='请求回调等待时间'
                className='p-2 rounded-lg w-full'
                {...methods.register('onebot.ws_server.timeout')}
                defaultValue={data.onebot.ws_server.timeout}
                placeholder='请输入请求回调等待时间'
                description={
                  <>
                    如果你需要配置WebSocketServer的鉴权秘钥 请跳转到
                    <a
                      href='./env'
                      className='text-primary font-medium hover:underline'
                    > 环境变量
                    </a>
                    选项卡哦
                  </>
                }
                isRequired
                color='primary'
              />
            </div>

            {/* WS Client 部分 */}
            <div className='text-lg font-medium flex items-center gap-2 mt-4'>
              <Network className='w-5 h-5' />
              正向 WebSocket 客户端
            </div>
            <Divider className='w-full' />
            <InternalAccordion
              list={wsClientFields.fields}
              add={addWsClient}
              remove={wsClientFields.remove}
              description='管理OneBot11协议的WebSocket客户端 也就是正向WebSocket'
              title='WebSocket 客户端'
              render={(index: number) => (
                <div className='flex flex-col gap-2 p-2'>
                  <Switch
                    className='p-2 rounded-lg bg-default-200/50 mb-3'
                    {...methods.register(`onebot.ws_client.${index}.enable`)}
                    color='success'
                  >
                    <span className='text-xs'>启用</span>
                  </Switch>
                  <Input
                    label='WebSocketServer 地址'
                    description='WebSocket的地址 也就是协议端的WebSocket服务端api地址 例如: ws://127.0.0.1:6099'
                    {...methods.register(`onebot.ws_client.${index}.url`)}
                    placeholder='WebSocket的地址'
                    className='p-2 rounded-lg w-full'
                    color='primary'
                  />
                  <Input
                    label='Token'
                    description='用于验证连接的Token 如果协议端没有设置无需填写'
                    {...methods.register(`onebot.ws_client.${index}.token`)}
                    placeholder='请输入 Token'
                    className='p-2 rounded-lg w-full'
                    color='primary'
                  />
                </div>
              )}
            />

            {/* HTTP Server 部分 */}
            <div className='text-lg font-medium flex items-center gap-2 mt-4'>
              <Server className='w-5 h-5' />
              HTTP 服务端
            </div>
            <Divider className='w-full' />
            <InternalAccordion
              list={httpServerFields.fields}
              add={addHttpServer}
              remove={httpServerFields.remove}
              description='管理OneBot11协议的HTTP POST服务端， 上报事件url: http://127.0.0.1:7777/onebot'
              title='HTTP 服务端'
              render={(index: number) => (
                <div className='flex flex-col gap-2 p-2'>
                  <Switch
                    className='p-2 rounded-lg bg-default-200/50 mb-3'
                    {...methods.register(`onebot.http_server.${index}.enable`)}
                    color='success'
                  >
                    <span className='text-xs'>启用</span>
                  </Switch>
                  <Input
                    label='Bot的QQ号'
                    description='Bot的QQ号'
                    {...methods.register(`onebot.http_server.${index}.self_id`)}
                    placeholder='Bot的QQ号'
                    className='p-2 rounded-lg w-full'
                    color='primary'
                  />
                  <Input
                    label='发送Api请求的URL地址'
                    {...methods.register(`onebot.http_server.${index}.url`)}
                    description='协议端的http api地址 例如napcat的: http://127.0.0.1:6099'
                    placeholder='发送Api请求的URL地址'
                    className='p-2 rounded-lg w-full'
                    color='primary'
                  />
                  <Input
                    label='用于发送Api请求的鉴权Token'
                    description='用于发送Api请求的鉴权Token 也就是协议端的api_token'
                    {...methods.register(`onebot.http_server.${index}.api_token`)}
                    placeholder='请输入用于发送Api请求的鉴权Token'
                    className='p-2 rounded-lg w-full'
                    color='primary'
                  />
                  <Input
                    label='用于验证请求合法的Token'
                    description='用于验证请求合法的Token 也就是协议端的上报事件的post_token'
                    {...methods.register(`onebot.http_server.${index}.post_token`)}
                    placeholder='请输入用于验证请求合法的Token'
                    className='p-2 rounded-lg w-full'
                    color='primary'
                  />
                </div>
              )}
            />
          </div>
        </div>
      </Form>
    </FormProvider>
  )
}
export default getAdapterComponent
