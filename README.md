# VsingerStudio

VsingerStudio 是一个面向虚拟歌手工作流的本地 AI 音乐创作平台。项目包含 React 前端、Express 后端、SQLite 数据库迁移、ACE-Step 生成接口适配、虚拟歌手管理、LoRA 训练与音色绑定、音乐库和播放器。

## 功能

- 创作：支持纯音乐、人声生成、参考音频、源音频、专家参数和已绑定虚拟歌手音色。
- 音乐库：管理生成歌曲、喜欢列表、歌单和参考音频。
- 虚拟歌手：维护歌手资料、风格标签、默认语言、性别、角色设定、备注和头像。
- 训练：上传训练音频、构建数据集、预处理、启动 LoRA 训练、导出并绑定音色。
- 音频工具：内置音频编辑器和 Demucs Web 分轨工具。

## 项目结构

```text
.
├─ components/              # React 业务组件
├─ constants/               # 前端枚举和选项
├─ context/                 # React 上下文
├─ data/                    # 风格词表
├─ i18n/                    # 多语言文案
├─ server/
│  ├─ scripts/              # ACE-Step 辅助脚本
│  ├─ src/
│  │  ├─ config/            # 后端配置
│  │  ├─ db/                # SQLite 连接与迁移
│  │  ├─ middleware/        # Express 中间件
│  │  ├─ routes/            # API 路由
│  │  └─ services/          # 生成、训练、存储等服务
│  ├─ audio-editor/         # 内置音频编辑器静态资源
│  └─ public/               # 后端静态资源
├─ services/                # 前端 API 客户端
├─ App.tsx
├─ index.tsx
└─ vite.config.ts
```

## 环境要求

- Node.js 18+
- npm
- Python 3.11
- FFmpeg
- 可运行并启用 API 的 ACE-Step 1.5 环境

## 环境变量

复制 `.env.example` 为 `.env`，按本机环境调整：

```env
PORT=3001
FRONTEND_URL=http://localhost:3000
ACESTEP_API_URL=http://localhost:8001
DATABASE_PATH=server/data/acestep.db
JWT_SECRET=change-this-secret
DATASETS_DIR=../ACE-Step-1.5/datasets
DATASETS_UPLOADS_DIR=../ACE-Step-1.5/datasets/uploads
PEXELS_API_KEY=
```

## 本地开发

先启动 ACE-Step API：

```bash
acestep --port 8001 --enable-api --backend pt --server-name 127.0.0.1
```

安装并启动后端：

```bash
cd server
npm install
npm run db:migrate
npm run dev
```

安装并启动前端：

```bash
npm install
npm run dev
```

默认地址：

- 前端：http://127.0.0.1:3000
- 后端：http://127.0.0.1:3001

## 构建

```bash
npm run build
cd server
npm run build
```

## 核心 API

- `POST /api/auth/setup`
- `GET /api/auth/me`
- `GET /api/songs`
- `POST /api/generate`
- `GET /api/generate/status/:jobId`
- `GET /api/generate/history`
- `GET /api/singers`
- `POST /api/singers`
- `PATCH /api/singers/:id`
- `DELETE /api/singers/:id`
- `POST /api/training/upload-audio`
- `POST /api/training/build-dataset`
- `POST /api/training/preprocess`
- `POST /api/training/start`
- `POST /api/training/export`
- `POST /api/training/bind-voice`

## 交付说明

仓库不包含本地依赖、构建产物、生成音频、数据库文件、训练数据集或 ACE-Step 模型目录。运行时产生的数据位于 `server/data`、`server/public/audio` 和配置的数据集目录中。
