import Link from "next/link";
import { FoodPhoto } from "../components/food-photo";
import { getPublicStatus } from "../server/status";
export const dynamic = "force-dynamic";
export default function Home() {
  const status = getPublicStatus();
  return <main id="main" className="home shell">
    <section className="hero"><div><h1>McTiming<span>麦麦时机官</span></h1><h2>你的单人餐预算搭配助手</h2><p className="hero-copy">选一家麦当劳门店，按你的预算和口味，<br />搭配主食、饮品和小食。</p><Link className="button primary" href="/recommend">开始推荐 <span aria-hidden="true">→</span></Link></div><FoodPhoto name="样例鸡肉主食" source="demo" hero /></section>
    <ol className="home-steps" aria-label="使用步骤"><li>选择门店</li><li>设置预算与口味</li><li>比较搭配，核对价格</li></ol>
    <section className="home-status"><div><h3>{status.mode === "demo" ? "先用样例体验" : "本地真实查询"}</h3><p>{status.mode === "demo" ? "门店、餐品与价格均为虚构，可体验推荐和模拟订单流程。" : "支持已验证的自取查询。费用未完整核验的金额仅供参考，真实交易未开放。"}</p></div><span className="pill">{status.configuration === "demo-ready" ? "演示模式 · 无需配置" : status.configuration === "configured" ? "已配置 · 连接待查询验证" : "尚未配置 MCP Token"}</span></section>
  </main>;
}
