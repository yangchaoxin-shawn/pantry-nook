import type { Dish, MealPlan } from "../../shared/api/client";
import { Empty, Icon } from "../../shared/ui/Primitives";

export function DishesPage({ dishes, search, setSearch, edit, remove }: { dishes: Dish[]; search: string; setSearch: (value: string) => void; edit: (dish: Dish) => void; remove: (dish: Dish) => void }) {
  const visible = dishes.filter((dish) => dish.name.includes(search.trim()));
  return <>
    <div className="filter-bar"><input type="search" aria-label="搜索菜品" placeholder="找一道熟悉的菜" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <section className="card"><div className="section-heading"><h2>我的菜品库</h2><span className="muted">保存菜名，随时搭配</span></div>
      {visible.map((dish) => <article className="list-row" key={dish.id}><span className="category-icon"><Icon name="book" /></span><strong>{dish.name}</strong><div className="actions"><button className="btn-ghost" onClick={() => edit(dish)}>编辑</button><button className="text-button danger" onClick={() => remove(dish)}>删除</button></div></article>)}
      {!visible.length && <Empty title="还没有找到菜品">把常做的菜记下来，下次就能直接选。</Empty>}
    </section>
  </>;
}

export function PlansPage({ plans, onUsePlan, edit, remove }: { plans: MealPlan[]; onUsePlan: (plan: MealPlan) => void; edit: (plan: MealPlan) => void; remove: (plan: MealPlan) => void }) {
  return <>
    <div className="inventory-grid">{plans.map((plan) => <article className="card plan-card" key={plan.id}><span className="eyebrow">喜欢的组合</span><h2>{plan.name || "未命名搭配"}</h2><div className="dish-tags">{plan.dishes.map((dish) => <span key={dish.id}>{dish.name}</span>)}</div><div className="actions"><button className="btn-primary" onClick={() => onUsePlan(plan)}>用这个搭配</button><button className="text-button" onClick={() => edit(plan)}>编辑</button><button className="text-button danger" onClick={() => remove(plan)}>删除</button></div></article>)}</div>
    {!plans.length && <section className="card"><Empty title="存一份喜欢的搭配">选几道菜组成模板，下次可以直接安排。</Empty></section>}
  </>;
}
