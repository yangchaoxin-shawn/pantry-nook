import { useState, useEffect } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

const CATEGORIES = ['蔬菜', '肉类', '海鲜', '碳水', '水果', '其他']
const CATEGORY_COLORS = {
  蔬菜: 'var(--green)',
  肉类: 'var(--red)',
  海鲜: 'var(--blue)',
  碳水: 'var(--amber)',
  水果: 'var(--pink)',
  其他: 'var(--gray)',
}

function App() {
  const [tab, setTab] = useState('ingredients')
  const [ingredients, setIngredients] = useState([])
  const [dishes, setDishes] = useState([])
  const [consumptions, setConsumptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [ingredientForm, setIngredientForm] = useState({
    name: '', category: '蔬菜', quantity: '一份', location: '冰箱',
    purchase_date: '', note: ''
  })

  const [dishForm, setDishForm] = useState({ date: '', items: '', note: '' })

  const [consumptionForm, setConsumptionForm] = useState({
    date: '', ingredient_id: '', quantity_used: '1份', dish_id: ''
  })

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      const [ingRes, dishRes, conRes] = await Promise.all([
        fetch(`${API_BASE}/api/ingredients`),
        fetch(`${API_BASE}/api/dishes`),
        fetch(`${API_BASE}/api/consumptions`),
      ])
      if (!ingRes.ok || !dishRes.ok || !conRes.ok) throw new Error('拉取数据失败')
      const ing = await ingRes.json()
      const dish = await dishRes.json()
      const con = await conRes.json()
      setIngredients(ing)
      setDishes(dish)
      setConsumptions(con)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  async function handleAddIngredient(e) {
    e.preventDefault()
    if (!ingredientForm.name) return alert('请输入食材名称')
    try {
      const res = await fetch(`${API_BASE}/api/ingredients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ingredientForm),
      })
      if (!res.ok) throw new Error(await res.text())
      setIngredientForm({ name: '', category: '蔬菜', quantity: '一份', location: '冰箱', purchase_date: '', note: '' })
      fetchData()
    } catch (err) {
      alert('添加失败：' + err.message)
    }
  }

  async function handleAddDish(e) {
    e.preventDefault()
    const items = dishForm.items.split(/[+＋,，\s]+/).filter(Boolean)
    if (!dishForm.date || items.length === 0) return alert('请填写日期和菜品')
    try {
      const res = await fetch(`${API_BASE}/api/dishes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...dishForm, items }),
      })
      if (!res.ok) throw new Error(await res.text())
      setDishForm({ date: '', items: '', note: '' })
      fetchData()
    } catch (err) {
      alert('添加失败：' + err.message)
    }
  }

  async function handleAddConsumption(e) {
    e.preventDefault()
    if (!consumptionForm.date || !consumptionForm.ingredient_id) return alert('请选择日期和食材')
    try {
      const res = await fetch(`${API_BASE}/api/consumptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(consumptionForm),
      })
      if (!res.ok) throw new Error(await res.text())
      setConsumptionForm({ date: '', ingredient_id: '', quantity_used: '1份', dish_id: '' })
      fetchData()
    } catch (err) {
      alert('添加失败：' + err.message)
    }
  }

  async function handleDeleteIngredient(id) {
    if (!confirm('确认删除该食材？')) return
    try {
      await fetch(`${API_BASE}/api/ingredients/${id}`, { method: 'DELETE' })
      fetchData()
    } catch (err) {
      alert('删除失败：' + err.message)
    }
  }

  const grouped = ingredients.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {})

  return (
    <div className="app">
      <header className="header">
        <h1>厨房助手</h1>
        <div className="tabs">
          <button className={tab === 'ingredients' ? 'tab active' : 'tab'} onClick={() => setTab('ingredients')}>食材</button>
          <button className={tab === 'dishes' ? 'tab active' : 'tab'} onClick={() => setTab('dishes')}>做菜记录</button>
          <button className={tab === 'consumptions' ? 'tab active' : 'tab'} onClick={() => setTab('consumptions')}>消耗</button>
        </div>
      </header>

      {error && <div className="error-banner">{error} <button onClick={fetchData}>重试</button></div>}
      {loading && <div className="loading">加载中...</div>}

      <main className="main">
        {tab === 'ingredients' && (
          <>
            <form className="card form" onSubmit={handleAddIngredient}>
              <h3>添加食材</h3>
              <div className="form-grid">
                <input placeholder="食材名称" value={ingredientForm.name} onChange={(e) => setIngredientForm({ ...ingredientForm, name: e.target.value })} />
                <select value={ingredientForm.category} onChange={(e) => setIngredientForm({ ...ingredientForm, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <input placeholder="数量（如：一份、两个）" value={ingredientForm.quantity} onChange={(e) => setIngredientForm({ ...ingredientForm, quantity: e.target.value })} />
                <select value={ingredientForm.location} onChange={(e) => setIngredientForm({ ...ingredientForm, location: e.target.value })}>
                  <option>冰箱</option>
                  <option>室温</option>
                  <option>冷冻</option>
                  <option>其他</option>
                </select>
                <input type="date" value={ingredientForm.purchase_date} onChange={(e) => setIngredientForm({ ...ingredientForm, purchase_date: e.target.value })} />
                <input placeholder="备注（选填）" value={ingredientForm.note} onChange={(e) => setIngredientForm({ ...ingredientForm, note: e.target.value })} />
              </div>
              <button type="submit" className="btn-primary">添加食材</button>
            </form>

            <h2 className="section-title">当前库存</h2>
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat} className="card">
                <h3 style={{ color: CATEGORY_COLORS[cat] }}>{cat} <span className="count">{items.length} 项</span></h3>
                <div className="ingredient-list">
                  {items.map((item) => (
                    <div key={item.id} className="ingredient-item">
                      <div className="ingredient-main">
                        <span className="ingredient-name">{item.name}</span>
                        <span className="ingredient-qty">{item.quantity}</span>
                        <span className="ingredient-loc">{item.location}</span>
                      </div>
                      <button className="btn-danger btn-sm" onClick={() => handleDeleteIngredient(item.id)}>删除</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {Object.keys(grouped).length === 0 && <div className="card empty">还没有食材，添加一条吧</div>}
          </>
        )}

        {tab === 'dishes' && (
          <>
            <form className="card form" onSubmit={handleAddDish}>
              <h3>记录一顿饭</h3>
              <div className="form-grid">
                <input type="date" value={dishForm.date} onChange={(e) => setDishForm({ ...dishForm, date: e.target.value })} />
                <input placeholder="菜品，用 + 或逗号分隔（如：米饭+奥尔良鸡翅+苦瓜炒蛋）" value={dishForm.items} onChange={(e) => setDishForm({ ...dishForm, items: e.target.value })} />
              </div>
              <button type="submit" className="btn-primary">添加记录</button>
            </form>

            <h2 className="section-title">历史记录</h2>
            {dishes.map((dish) => (
              <div key={dish.id} className="card dish-card">
                <div className="dish-header">
                  <span className="dish-date">{dish.date}</span>
                </div>
                <div className="dish-items">
                  {dish.items.map((item, i) => <span key={i} className="dish-tag">{item}</span>)}
                </div>
                {dish.note && <p className="dish-note">{dish.note}</p>}
              </div>
            ))}
            {dishes.length === 0 && <div className="card empty">还没有做菜记录</div>}
          </>
        )}

        {tab === 'consumptions' && (
          <>
            <form className="card form" onSubmit={handleAddConsumption}>
              <h3>记录消耗</h3>
              <div className="form-grid">
                <input type="date" value={consumptionForm.date} onChange={(e) => setConsumptionForm({ ...consumptionForm, date: e.target.value })} />
                <select value={consumptionForm.ingredient_id} onChange={(e) => setConsumptionForm({ ...consumptionForm, ingredient_id: e.target.value })}>
                  <option value="">选择食材</option>
                  {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <input placeholder="消耗数量（如：1份）" value={consumptionForm.quantity_used} onChange={(e) => setConsumptionForm({ ...consumptionForm, quantity_used: e.target.value })} />
              </div>
              <button type="submit" className="btn-primary">记录消耗</button>
            </form>

            <h2 className="section-title">消耗历史</h2>
            {consumptions.map((con) => {
              const ingredient = ingredients.find((i) => i.id === con.ingredient_id)
              return (
                <div key={con.id} className="card consumption-item">
                  <span className="dish-date">{con.date}</span>
                  <span className="consumption-name">{ingredient ? ingredient.name : '未知'}</span>
                  <span className="ingredient-qty">{con.quantity_used}</span>
                </div>
              )
            })}
            {consumptions.length === 0 && <div className="card empty">还没有消耗记录</div>}
          </>
        )}
      </main>
    </div>
  )
}

export default App
