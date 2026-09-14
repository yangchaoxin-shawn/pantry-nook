import type { Dish, MealPlan } from "../../shared/api/client";
import { Empty } from "../../shared/ui/Primitives";
import './catalog.css';

export function DishesPage({ dishes, search, setSearch, edit, remove }: { dishes: Dish[]; search: string; setSearch: (value: string) => void; edit: (dish: Dish) => void; remove: (dish: Dish) => void }) {
  const visible = dishes.filter((dish) => dish.name.includes(search.trim()));
  return <>
    <div className="filter-bar dish-search"><input type="search" aria-label="搜索菜品" placeholder="找一道熟悉的菜" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <section className="dish-book" aria-labelledby="dish-book-title">
      <div className="dish-book-heading">
        <h2 id="dish-book-title">我的菜品簿</h2>
        <span className="dish-book-count">{search.trim() ? '找到' : '记下'} <b>{visible.length}</b> 道菜</span>
      </div>
      {visible.length > 0 ? <div className="dish-book-body">
        <span className="dish-book-margin" aria-hidden="true">家常，也值得惦记。</span>
        <div className="dish-name-flow">{visible.map((dish) => <article
          className={`dish-entry dish-stroke-${dish.id % 4}${Array.from(dish.name).length > 8 ? ' dish-entry-long' : ''}`}
          key={dish.id} aria-labelledby={`dish-name-${dish.id}`}>
          <h3 id={`dish-name-${dish.id}`}><span>{dish.name}</span></h3>
          <div className="dish-entry-actions">
            <button type="button" className="dish-edit" aria-label={`编辑${dish.name}`} onClick={() => edit(dish)}>编辑</button>
            <button type="button" className="dish-delete" aria-label={`删除${dish.name}`} onClick={() => remove(dish)}>删除</button>
          </div>
        </article>)}</div>
      </div> : <Empty title={search.trim() ? '这道菜还没记在这里' : '菜单簿的第一页，留给你'}>{search.trim() ? '换个名字找找，或清空搜索看看所有菜品。' : '把常做的菜记下来，下次就能直接选。'}{search.trim() && <button type="button" className="text-button dish-clear-search" onClick={() => setSearch('')}>查看全部菜品</button>}</Empty>}
      <div className="dish-book-footer" aria-hidden="true"><span>一餐一饭，慢慢攒。</span><span>∿</span></div>
    </section>
  </>;
}

export function PlansPage({ plans, onUsePlan, edit, remove }: { plans: MealPlan[]; onUsePlan: (plan: MealPlan) => void; edit: (plan: MealPlan) => void; remove: (plan: MealPlan) => void }) {
  return <>
    <div className="inventory-grid">{plans.map((plan) => <article className="card plan-card" key={plan.id}><span className="eyebrow">喜欢的组合</span><h2>{plan.name || "未命名搭配"}</h2><div className="dish-tags">{plan.dishes.map((dish) => <span key={dish.id}>{dish.name}</span>)}</div><div className="actions"><button className="btn-primary" onClick={() => onUsePlan(plan)}>用这个搭配</button><button className="text-button" onClick={() => edit(plan)}>编辑</button><button className="text-button danger" onClick={() => remove(plan)}>删除</button></div></article>)}</div>
    {!plans.length && <section className="card"><Empty title="存一份喜欢的搭配">选几道菜组成模板，下次可以直接安排。</Empty></section>}
  </>;
}
