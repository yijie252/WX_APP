微信运动最小解密服务
====================

目录：
  server/werun-server.js

用途：
  接收小程序上传的 code + encryptedData + iv，
  调用微信 jscode2session 获取 session_key，
  在服务端解密微信运动步数，返回最近一天步数与 stepInfoList。

启动步骤：
  1. 将 `.env.example` 复制为 `.env`
  2. 填入：
       WECHAT_APPID=你的小程序 AppID
       WECHAT_SECRET=你的小程序 AppSecret
  3. 运行：
       node werun-server.js

默认地址：
  http://localhost:8787/health
  http://localhost:8787/api/werun/decrypt

小程序配置：
  1. 在 `config/runtime.js` 中填写解密接口地址
  2. 在微信公众平台后台配置 request 合法域名
  3. 真机环境不能直接访问 localhost，需改为可访问的局域网或 HTTPS 域名
