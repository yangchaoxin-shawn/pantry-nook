from __future__ import annotations
from decimal import Decimal
from fastapi import APIRouter, Request
from ..db import get_pool, lock_inventory_workflow, assert_stock_name_available
from ..errors import conflict, not_found, validation_error
from ..responses import created, ok
from ..validation import enum_value, ensure_object_body, optional_number, optional_text, pagination, parse_id, required_text
from ..menu_workflow import assert_version
from ..quantity import render_stock
router=APIRouter()
CATEGORIES=["碳水","蔬菜","蛋白质","水果","其他"]; LOCATIONS=["冰箱冷藏","冰箱冷冻","室温","其他"]; REASONS=["spoiled","damaged","other"]
FACTORS={"g":("m",Decimal(1)),"kg":("m",Decimal(1000)),"斤":("m",Decimal(500)),"ml":("v",Decimal(1)),"L":("v",Decimal(1000))}
def dto(x):
 return {k:x[k] for k in ("id","name","category","stock_text","stock_value","stock_unit","location","note","created_at","updated_at")}
def payload(b,partial=False):
 r={};has=lambda k:k in b
 if not partial or has("name"):r["name"]=required_text(b.get("name"),"name")
 if not partial or has("category"):r["category"]=enum_value(b.get("category"),"category",CATEGORIES)
 if not partial or has("stock_text"):r["stock_text"]=required_text(b.get("stock_text"),"stock_text")
 if not partial or has("stock_value"):
  v=optional_number(b.get("stock_value"),"stock_value",min_value=0)
  if v is None:raise validation_error("stock_value 必须是数字")
  r["stock_value"]=v
 if not partial or has("stock_unit"):r["stock_unit"]=required_text(b.get("stock_unit"),"stock_unit",50)
 if has("location"):r["location"]=enum_value(b.get("location"),"location",LOCATIONS,optional=True)
 if has("note"):r["note"]=optional_text(b.get("note"),"note",5000)
 if partial and not r:raise validation_error("至少需要提供一个可修改字段")
 return r
def render(v):return render_stock(v)
def convert(v,a,b):
 if a==b:return v
 x,y=FACTORS.get(a),FACTORS.get(b)
 return v*x[1]/y[1] if x and y and x[0]==y[0] else None
def resolutions(body):
 raw=body.get("resolutions",[])
 if not isinstance(raw,list):raise validation_error("resolutions 必须是数组")
 out={}
 for entry in raw:
  entry=ensure_object_body(entry); iid=parse_id(entry.get("ingredient_id"),"ingredient_id")
  final=optional_number(entry.get("final_stock_value"),"final_stock_value",min_value=0) if "final_stock_value" in entry else None
  out[iid]={"expected_updated_at":entry.get("expected_updated_at"),"category":enum_value(entry["category"],"category",CATEGORIES) if "category" in entry else None,"stock_unit":required_text(entry["stock_unit"],"stock_unit",50) if "stock_unit" in entry else None,"final_stock_value":final,"final_stock_text":required_text(entry.get("final_stock_text"),"final_stock_text") if final is not None else None}
 return out
@router.get("")
async def listed(request:Request):
 q=dict(request.query_params);limit,offset=pagination(q).values();where=["i.status='active'"];vals=[]
 if "category" in q:vals.append(enum_value(q["category"],"category",CATEGORIES));where.append("i.category=$"+str(len(vals)))
 if "location" in q:vals.append(enum_value(q["location"],"location",LOCATIONS));where.append("i.location=$"+str(len(vals)))
 if "q" in q:vals.append("%"+required_text(q["q"],"q",100)+"%");where.append("(i.name ILIKE $"+str(len(vals))+" OR COALESCE(i.note,'') ILIKE $"+str(len(vals))+")")
 clause="WHERE "+" AND ".join(where);vals.extend([limit,offset]);pool=await get_pool()
 rows=await pool.fetch("SELECT i.*,COUNT(*) OVER()::int total FROM ingredients i "+clause+" ORDER BY i.category,LOWER(i.name) LIMIT $"+str(len(vals)-1)+" OFFSET $"+str(len(vals)),*vals)
 total=rows[0]["total"] if rows else 0
 if not rows and offset:total=await pool.fetchval("SELECT COUNT(*) FROM ingredients i "+clause,*vals[:-2])
 return ok([dto(x) for x in rows],{"total":int(total),"limit":limit,"offset":offset})
@router.get("/{ingredient_id}")
async def one(ingredient_id:int):
 row=await (await get_pool()).fetchrow("SELECT * FROM ingredients WHERE id=$1 AND status='active'",parse_id(ingredient_id))
 if row is None:raise not_found("食材")
 return ok(dto(row))
@router.post("/batch")
async def batch(request:Request):
 b=ensure_object_body(await request.json());raw=b.get("items")
 if not isinstance(raw,list) or not raw:raise validation_error("items 必须至少包含一项食材")
 if len(raw)>30:raise validation_error("一次最多记录 30 项食材")
 rows=[payload(ensure_object_body(x)) for x in raw]
 if len({x["name"].casefold() for x in rows})!=len(rows):raise validation_error("同一批不能重复填写同名食材")
 selected=resolutions(b)
 pool=await get_pool();out=[]
 async with pool.acquire() as c:
  async with c.transaction():
   await lock_inventory_workflow(c)
   for x in rows:
    old=await c.fetchrow("SELECT * FROM ingredients WHERE status='active' AND LOWER(btrim(name))=LOWER(btrim($1)) FOR UPDATE",x["name"])
    if old is None:row=await c.fetchrow("INSERT INTO ingredients(name,category,stock_text,stock_value,stock_unit,location,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",x["name"],x["category"],x["stock_text"],x["stock_value"],x["stock_unit"],x.get("location"),x.get("note"))
    else:
     choice=selected.get(int(old["id"]),{})
     if old["category"]!=x["category"] and not choice.get("category"):raise conflict("同名食材分类不同，请在弹窗中选择保留的分类")
     if old["stock_unit"]!=x["stock_unit"] and not choice.get("stock_unit"):raise conflict("同名食材单位不同，请在弹窗中选择统一单位")
     category=choice.get("category") or old["category"];unit=choice.get("stock_unit") or old["stock_unit"];location=x.get("location") if x.get("location") is not None else old["location"]
     before=convert(Decimal(old["stock_value"]),old["stock_unit"],unit);incoming=convert(Decimal(x["stock_value"]),x["stock_unit"],unit)
     if before is None or incoming is None:
      if choice.get("final_stock_value") is None:raise conflict("这两个单位不能自动换算，请在弹窗填写合并后的实际库存")
      assert_version(required_text(choice.get("expected_updated_at"),"expected_updated_at",64),old["updated_at"])
      v=Decimal(choice["final_stock_value"]);text=choice["final_stock_text"]
     else:v=before+incoming;text=render(v)
     optional_number(v,"合并后的库存量",min_value=0)
     row=await c.fetchrow("UPDATE ingredients SET category=$1,stock_text=$2,stock_value=$3,stock_unit=$4,location=$5,updated_at=NOW() WHERE id=$6 RETURNING *",category,text,v,unit,location,old["id"])
    out.append(dto(row))
 return created(out)
@router.patch("/{ingredient_id}")
async def patch(ingredient_id:int,request:Request):
 b=ensure_object_body(await request.json());x=payload(b,True);pid=parse_id(ingredient_id)
 if x.get("stock_value")==0:raise validation_error("库存为零请使用“处理变质/损坏”")
 keys=list(x);pool=await get_pool()
 async with pool.acquire() as c:
  async with c.transaction():
   await lock_inventory_workflow(c)
   old=await c.fetchrow("SELECT * FROM ingredients WHERE id=$1 AND status='active' FOR UPDATE",pid)
   if old is None:raise not_found("食材")
   if "name" in x:await assert_stock_name_available(c,x["name"],pid)
   if any(k.startswith("stock_") for k in keys):
    version=required_text(b.get("expected_updated_at"),"expected_updated_at",64)
    assert_version(version,old["updated_at"])
   row=await c.fetchrow("UPDATE ingredients SET "+", ".join(k+"=$"+str(i+1) for i,k in enumerate(keys))+",updated_at=NOW() WHERE id=$"+str(len(keys)+1)+" AND status='active' RETURNING *",*[x[k] for k in keys],pid)
 if row is None:raise not_found("食材")
 return ok(dto(row))
@router.post("/{ingredient_id}/waste")
async def waste(ingredient_id:int,request:Request):
 b=ensure_object_body(await request.json());pid=parse_id(ingredient_id);v=optional_number(b.get("stock_value"),"stock_value",min_value=0,exclusive_min=True)
 if v is None:raise validation_error("stock_value 必须大于零")
 unit=required_text(b.get("stock_unit"),"stock_unit",50);reason=enum_value(b.get("reason"),"reason",REASONS);note=optional_text(b.get("note"),"note",5000);version=required_text(b.get("expected_updated_at"),"expected_updated_at",64);pool=await get_pool()
 async with pool.acquire() as c:
  async with c.transaction():
   await lock_inventory_workflow(c);old=await c.fetchrow("SELECT * FROM ingredients WHERE id=$1 AND status='active' FOR UPDATE",pid)
   if old is None:raise not_found("食材")
   assert_version(version,old["updated_at"])
   if unit!=old["stock_unit"]:raise validation_error("处理单位必须与当前库存单位一致")
   before,used=Decimal(old["stock_value"]),Decimal(v)
   if used>before:raise conflict("处理数量不能超过当前库存")
   after=before-used;status="discarded" if after==0 else "active";text="0" if after==0 else render(after)
   row=await c.fetchrow("UPDATE ingredients SET stock_text=$1,stock_value=$2,status=$3,ended_at=CASE WHEN $3::varchar='discarded' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$4 RETURNING *",text,after,status,pid)
   a=await c.fetchrow("INSERT INTO inventory_adjustments(ingredient_id,reason,note,stock_before_text,stock_before_value,stock_before_unit,stock_after_text,stock_after_value,stock_after_unit,stock_after_updated_at,ingredient_status_before,ingredient_ended_at_before,ingredient_status_after,ingredient_ended_at_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *",pid,reason,note,old["stock_text"],before,old["stock_unit"],text,after,old["stock_unit"],row["updated_at"],old["status"],old["ended_at"],row["status"],row["ended_at"])
 return created({"inventory":dto(row),"adjustment":dict(a)})
@router.get("/{ingredient_id}/adjustments")
async def history(ingredient_id:int):
 pid=parse_id(ingredient_id);pool=await get_pool()
 if not await pool.fetchrow("SELECT id FROM ingredients WHERE id=$1",pid):raise not_found("食材")
 return ok([dict(x) for x in await pool.fetch("SELECT a.*,i.name AS ingredient_name,i.category FROM inventory_adjustments a JOIN ingredients i ON i.id=a.ingredient_id WHERE a.ingredient_id=$1 ORDER BY a.created_at DESC,a.id DESC",pid)])
@router.post("/adjustments/{adjustment_id}/revoke")
async def revoke(adjustment_id:int):
 aid=parse_id(adjustment_id);pool=await get_pool()
 async with pool.acquire() as c:
  async with c.transaction():
   await lock_inventory_workflow(c);a=await c.fetchrow("SELECT * FROM inventory_adjustments WHERE id=$1 FOR UPDATE",aid)
   if a is None:raise not_found("库存处理记录")
   if a["status"]!="active":raise conflict("这条库存处理已撤销")
   old=await c.fetchrow("SELECT * FROM ingredients WHERE id=$1 FOR UPDATE",a["ingredient_id"])
   if old is None:raise not_found("食材")
   if old["updated_at"]!=a["stock_after_updated_at"]:raise conflict("该食材已有后续库存变更，不能安全撤销")
   if a["ingredient_status_before"]=="active":await assert_stock_name_available(c,old["name"],old["id"])
   row=await c.fetchrow("UPDATE ingredients SET stock_text=$1,stock_value=$2,stock_unit=$3,status=$4,ended_at=$5,updated_at=NOW() WHERE id=$6 RETURNING *",a["stock_before_text"],a["stock_before_value"],a["stock_before_unit"],a["ingredient_status_before"],a["ingredient_ended_at_before"],old["id"])
   a=await c.fetchrow("UPDATE inventory_adjustments SET status='reversed',reversed_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",aid)
 return ok({"inventory":dto(row),"adjustment":dict(a)})
