微信运动解密云函数
==================

目录：
  cloudfunctions/decryptWeRun/index.js

使用方式：
  1. 打开 local.config.example.js 参考格式
  2. 在同目录维护 local.config.js，填写小程序 AppID / AppSecret
  3. 在微信开发者工具中选择云环境
  4. 右键 cloudfunctions/decryptWeRun 上传并部署

支持动作：
  - action: 'health'   返回云函数配置状态
  - action: 'decrypt'  解密微信运动并返回 latestStep

说明：
  - local.config.js 已加入 git ignore，不会默认提交
  - 若需要改用环境变量，也可通过 process.env.WECHAT_APPID / WECHAT_SECRET 提供
