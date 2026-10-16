import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { getPublicStatus } from "../server/status";

export const metadata: Metadata = {
  title: "McTiming · 麦麦时机官",
  description: "你的单人餐预算搭配助手。先选口味，再看预算，安心核对每一份搭配。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const status = getPublicStatus();
  return <html lang="zh-CN"><body><a className="skip" href="#main">跳到主要内容</a><header className="site-header"><Link href="/" className="brand"><span className="brand-icon">m<span>·</span></span><span>McTiming<small>麦麦时机官</small></span></Link><nav aria-label="主导航"><Link href="/">首页</Link><Link href="/recommend">搭配工作台</Link></nav><span className={`mode-badge ${status.mode}`}>{status.mode === "demo" ? "演示模式" : "真实模式"}</span></header><div className="mode-notice">{status.mode === "demo" ? "样例演示，不产生真实订单。" : "本地真实模式 · 完整费用与优惠仍待验证 · 真实交易未开放"}</div>{children}<footer className="site-footer"><span>McTiming · 让今天这顿饭，合口味也合预算。</span><span>独立参赛项目 · 非麦当劳官方点餐平台</span></footer></body></html>;
}
