# DotCash

[![CI](https://github.com/gyh2016/DotCash/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/gyh2016/DotCash/actions/workflows/ci.yml)

DotCash 是一个基于 React + TypeScript + IndexedDB 的多币种本地记账应用。

## 功能概览

- 账户管理（创建、编辑、列表展示）
- 交易记录（收入/支出）
- 多币种记账与汇率换算（自动/手动）
- 预估入账与实际入账更正
- 交易货币转换费与手续费（支持固定金额/比例）
- 搜索筛选、分页、软删除恢复
- 首页看板与统计分析（趋势图、分类占比、账户维度）

## 技术栈

- React 18
- TypeScript
- Vite
- Dexie（IndexedDB）
- Recharts
- React Hook Form

## 本地运行

```bash
npm install
npm run dev
```

默认访问地址：

- `http://localhost:5173/`

## 构建

```bash
npm run build
npm run preview
```

## License

MIT
