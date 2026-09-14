import type { Dish, MealPlan } from "../../shared/api/client";
import { LittlePerson } from "../../shared/ui/LittlePerson";
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
          <div className="dish-entry-title">
            <LittlePerson namespace="dish" businessId={dish.id} className="dish-entry-person" />
            <h3 id={`dish-name-${dish.id}`}><span>{dish.name}</span></h3>
          </div>
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
    <section className={`plan-composer${plans.length ? '' : ' plan-composer-empty'}`} aria-labelledby="plan-composer-title">
      <header className="plan-composer-heading">
        <div>
          <span className="eyebrow">KITCHEN SET LIST</span>
          <h2 id="plan-composer-title">厨房搭配编排册</h2>
        </div>
        <p><b>{plans.length}</b><span>份顺手组合</span></p>
      </header>
      {plans.length > 0 ? <div className="plan-composer-list">{plans.map((plan, index) => {
        const planName = plan.name || "未命名搭配";
        return <article className={`plan-strip plan-strip-${index % 3}`} key={plan.id} aria-labelledby={`plan-title-${plan.id}`}>
          <div className="plan-strip-index" aria-hidden="true"><span>NO.</span><b>{String(index + 1).padStart(2, '0')}</b></div>
          <div className="plan-strip-main">
            <div className="plan-strip-title">
              <span className="plan-strip-caption">这一餐，照着搭</span>
              <h3 id={`plan-title-${plan.id}`}>{planName}</h3>
            </div>
            <ol className="plan-dish-route" aria-label={`${planName}包含的菜品`}>
              {plan.dishes.map((dish) => <li key={dish.id}><span>{dish.name}</span></li>)}
            </ol>
            <div className="plan-strip-actions">
              <button type="button" className="plan-use" onClick={() => onUsePlan(plan)} aria-label={`用${planName}安排一餐`}><span>用这份</span><b>安排一餐</b></button>
              <button type="button" className="plan-edit" onClick={() => edit(plan)} aria-label={`编辑${planName}`}>编辑搭配</button>
              <button type="button" className="plan-delete" onClick={() => remove(plan)} aria-label={`删除${planName}`}>删除</button>
            </div>
          </div>
          <LittlePerson namespace="plan" businessId={plan.id} className="plan-strip-person" />
        </article>;
      })}</div> : <div className="plan-composer-empty-state"><Empty title="存一份喜欢的搭配">选几道菜组成模板，下次可以直接安排。</Empty></div>}
      <footer className="plan-composer-foot" aria-hidden="true"><span>先把喜欢的味道排在一起</span><i>↝</i></footer>
    </section>
  </>;
}
