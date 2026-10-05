import type { Consumption } from "../../shared/api/client";
import { Empty } from "../../shared/ui/Primitives";

export function ConsumptionPage({ consumptions, search, status, setSearch, setStatus }: { consumptions: Consumption[]; search: string; status: string; setSearch: (value: string) => void; setStatus: (value: string) => void }) {
  const visible = consumptions.filter((item) => (status === "all" || status === item.status) && `${item.ingredient_name} ${item.quantity_used_text}`.includes(search.trim()));
  return <>
    <div className="filter-bar"><input aria-label="搜索消耗记录" type="search" placeholder="搜索食材或消耗原文" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="消耗状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部记录</option><option value="active">有效消耗</option><option value="reversed">已撤销</option></select></div>
    <section className="card"><div className="section-heading"><h2>消耗记录</h2><span className="muted">保留每次确认与撤销</span></div>
      {visible.map((item) => <article className="consumption-row" key={item.id}><div><small>{item.battle_date} · 作战 #{item.daily_battle_id}</small><h3>{item.ingredient_name}</h3><p>用了 {item.quantity_used_text}{item.daily_battle_dish_name ? ` · ${item.daily_battle_dish_name}` : ""}</p><p className="muted">当时余量：{item.remaining_before_text ?? "未记录"} → {item.remaining_after_text ?? "未记录"}</p></div><span className={`badge ${item.status === "active" ? "confirmed" : "cancelled"}`}>{item.status === "active" ? "有效消耗" : "已撤销"}</span></article>)}
      {!visible.length && (consumptions.length
        ? <Empty title="没有匹配的消耗记录">换个关键词或切换筛选状态再试。</Empty>
        : <Empty title="这里还没有消耗记录">做完饭后核对用料并确认，记录就会出现在这里。</Empty>)}
    </section>
  </>;
}
