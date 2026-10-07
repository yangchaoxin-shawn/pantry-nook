from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from fastapi import APIRouter, Request
from ..db import get_pool, lock_inventory_workflow, assert_stock_name_available
from ..errors import conflict, not_found, validation_error
from ..responses import created, ok
from ..validation import enum_value, ensure_object_body, like_pattern, optional_number, optional_text, pagination, parse_id, read_json_object, required_text
from ..menu_workflow import assert_version
from ..quantity import convert_unit, normalize_stock, parse_planned_quantity, render_stock
router=APIRouter()
CATEGORIES=["碳水","蔬菜","蛋白质","水果","汤料","其他"]; LOCATIONS=["冰箱冷藏","冰箱冷冻","室温","其他"]; WASTE_REASONS=["spoiled","damaged","other"]
def dto(x):
 return {k:x[k] for k in ("id","name","category","stock_text","stock_value","stock_unit","location","note","created_at","updated_at")}
def assert_stock_fields(r,partial=False):
 stock_fields={"stock_text","stock_value","stock_unit"};provided=stock_fields.intersection(r)
 if partial and provided and provided!=stock_fields:raise validation_error("修改库存数量时，请同时提交数量原文、数值和单位")
 if provided==stock_fields:
  parsed=normalize_stock(parse_planned_quantity(r["stock_text"],r["stock_unit"]))
  if parsed!=normalize_stock(Decimal(r["stock_value"])):raise validation_error("库存数量原文与数值不一致")
def payload(b,partial=False):
 r={};has=lambda k:k in b
 if not partial or has("name"):r["name"]=required_text(b.get("name"),"name")
 if not partial or has("category"):r["category"]=enum_value(b.get("category"),"category",CATEGORIES)
 if not partial or has("stock_text"):r["stock_text"]=required_text(b.get("stock_text"),"stock_text")
 if not partial or has("stock_value"):
  v=optional_number(b.get("stock_value"),"stock_value",min_value=0,exclusive_min=True)
  if v is None:raise validation_error("stock_value 必须是数字")
  r["stock_value"]=v
 if not partial or has("stock_unit"):r["stock_unit"]=required_text(b.get("stock_unit"),"stock_unit",50)
 if has("location"):r["location"]=enum_value(b.get("location"),"location",LOCATIONS,optional=True)
 if has("note"):r["note"]=optional_text(b.get("note"),"note",5000)
 if partial and not r:raise validation_error("至少需要提供一个可修改字段")
 assert_stock_fields(r,partial)
 return r
def render(v):return render_stock(v)
def convert(v,a,b):
 return convert_unit(v,a,b)
async def apply_adjustment(c,old,used,reason,note,depleted_status,client_request_id=None):
 before=Decimal(old["stock_value"])
 if used>before:raise conflict(("用掉" if reason=="used" else "处理")+"数量不能超过当前库存")
 after=before-used;status=depleted_status if after==0 else "active";after_text="0" if after==0 else render(after)
 row=await c.fetchrow("UPDATE ingredients SET stock_text=$1,stock_value=$2,status=$3,ended_at=CASE WHEN $3::varchar<>'active' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$4 RETURNING *",after_text,after,status,old["id"])
 adjustment=await c.fetchrow("INSERT INTO inventory_adjustments(ingredient_id,reason,note,client_request_id,stock_before_text,stock_before_value,stock_before_unit,stock_after_text,stock_after_value,stock_after_unit,stock_after_updated_at,ingredient_status_before,ingredient_ended_at_before,ingredient_status_after,ingredient_ended_at_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *",old["id"],reason,note,client_request_id,old["stock_text"],before,old["stock_unit"],after_text,after,old["stock_unit"],row["updated_at"],old["status"],old["ended_at"],row["status"],row["ended_at"])
 return row,adjustment
def resolutions(body):
 raw=body.get("resolutions",[])
 if not isinstance(raw,list):raise validation_error("resolutions 必须是数组")
 out={}
 for entry in raw:
  entry=ensure_object_body(entry); iid=parse_id(entry.get("ingredient_id"),"ingredient_id")
  final=optional_number(entry.get("final_stock_value"),"final_stock_value",min_value=0,exclusive_min=True) if "final_stock_value" in entry else None
  final_text=required_text(entry.get("final_stock_text"),"final_stock_text") if final is not None else None
  unit=required_text(entry["stock_unit"],"stock_unit",50) if "stock_unit" in entry else None
  if final is not None:
   if unit is None:raise validation_error("人工合并库存时必须选择最终单位")
   if normalize_stock(parse_planned_quantity(final_text,unit))!=normalize_stock(Decimal(final)):raise validation_error("合并后的数量原文与数值不一致")
  out[iid]={"expected_updated_at":entry.get("expected_updated_at"),"category":enum_value(entry["category"],"category",CATEGORIES) if "category" in entry else None,"stock_unit":unit,"final_stock_value":final,"final_stock_text":final_text}
 return out
@router.get("")
async def listed(request:Request):
 q=dict(request.query_params);limit,offset=pagination(q).values();where=["i.status='active'"];vals=[]
 if "category" in q:vals.append(enum_value(q["category"],"category",CATEGORIES));where.append("i.category=$"+str(len(vals)))
 if "location" in q:vals.append(enum_value(q["location"],"location",LOCATIONS));where.append("i.location=$"+str(len(vals)))
 if "q" in q:vals.append(like_pattern(required_text(q["q"],"q",100)));where.append("(i.name ILIKE $"+str(len(vals))+" ESCAPE '"+chr(92)+"' OR COALESCE(i.note,'') ILIKE $"+str(len(vals))+" ESCAPE '"+chr(92)+"'")
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
 b=await read_json_object(request);raw=b.get("items")
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
 b=await read_json_object(request);x=payload(b,True);pid=parse_id(ingredient_id)
 if x.get("stock_value")==0:raise validation_error("库存为零请使用“处理变质/损坏”")
 keys=list(x);pool=await get_pool()
 async with pool.acquire() as c:
  async with c.transaction():
   await lock_inventory_workflow(c)
   old=await c.fetchrow("SELECT * FROM ingredients WHERE id=$1 AND status='active' FOR UPDATE",pid)
   if old is None:raise not_found("食材")
   if "name" in x:await assert_stock_name_available(c,x["name"],pid)
   version=required_text(b.get("expected_updated_at"),"expected_updated_at",64)
   assert_version(version,old["updated_at"],dto(old))
   row=await c.fetchrow("UPDATE ingredients SET "+", ".join(k+"=$"+str(i+1) for i,k in enumerate(keys))+",updated_at=NOW() WHERE id=$"+str(len(keys)+1)+" AND status='active' RETURNING *",*[x[k] for k in keys],pid)
 if row is None:raise not_found("食材")
 return ok(dto(row))
@router.post("/{ingredient_id}/waste")
async def waste(ingredient_id:int,request:Request):
 b=await read_json_object(request);pid=parse_id(ingredient_id);v=optional_number(b.get("stock_value"),"stock_value",min_value=0,exclusive_min=True)
 if v is None:raise validation_error("stock_value 必须大于零")
 unit=required_text(b.get("stock_unit"),"stock_unit",50);text=required_text(b.get("stock_text"),"stock_text");reason=enum_value(b.get("reason"),"reason",WASTE_REASONS);note=optional_text(b.get("note"),"note",5000);version=required_text(b.get("expected_updated_at"),"expected_updated_at",64);pool=await get_pool()
 if normalize_stock(parse_planned_quantity(text,unit))!=normalize_stock(Decimal(v)):raise validation_error("处理数量原文与数值不一致")
 async with pool.acquire() as c:
  async with c.transaction():
   await lock_inventory_workflow(c);old=await c.fetchrow("SELECT * FROM ingredients WHERE id=$1 AND status='active' FOR UPDATE",pid)
   if old is None:raise not_found("食材")
   assert_version(version,old["updated_at"],dto(old))
   if unit!=old["stock_unit"]:raise validation_error("处理单位必须与当前库存单位一致")
   row,a=await apply_adjustment(c,old,Decimal(v),reason,note,"discarded")
 return created({"inventory":dto(row),"adjustment":dict(a)})

@router.post("/{ingredient_id}/use")
async def use(ingredient_id:int,request:Request):
 b=await read_json_object(request);pid=parse_id(ingredient_id);v=optional_number(b.get("stock_value"),"stock_value",min_value=0,exclusive_min=True)
 if v is None:raise validation_error("stock_value 必须大于零")
 unit=required_text(b.get("stock_unit"),"stock_unit",50);text=required_text(b.get("stock_text"),"stock_text");version=required_text(b.get("expected_updated_at"),"expected_updated_at",64)
 try: request_id=UUID(required_text(b.get("client_request_id"),"client_request_id",64))
 except ValueError: raise validation_error("client_request_id 必须是有效 UUID")
 if normalize_stock(parse_planned_quantity(text,unit))!=normalize_stock(Decimal(v)):raise validation_error("用掉数量原文与数值不一致")
 pool=await get_pool()
 async with pool.acquire() as c:
  async with c.transaction():
   await lock_inventory_workflow(c)
   replay=await c.fetchrow("SELECT * FROM inventory_adjustments WHERE client_request_id=$1 FOR UPDATE",request_id)
   if replay is not None:
    replayed_amount=Decimal(replay["stock_before_value"])-Decimal(replay["stock_after_value"])
    if replay["ingredient_id"]!=pid or replay["reason"]!="used" or replay["stock_before_unit"]!=unit or replayed_amount!=Decimal(v):raise conflict("这次操作标识已经用于其他库存变更")
    current=await c.fetchrow("SELECT * FROM ingredients WHERE id=$1",pid)
    if current is None:raise not_found("食材")
    return created({"inventory":dto(current),"adjustment":dict(replay)})
   old=await c.fetchrow("SELECT * FROM ingredients WHERE id=$1 AND status='active' FOR UPDATE",pid)
   if old is None:raise not_found("食材")
   assert_version(version,old["updated_at"],dto(old))
   if unit!=old["stock_unit"]:raise validation_error("用掉数量的单位必须与当前库存单位一致")
   row,a=await apply_adjustment(c,old,Decimal(v),"used",None,"consumed",request_id)
 return created({"inventory":dto(row),"adjustment":dict(a)})
@router.get("/{ingredient_id}/adjustments")
async def history(ingredient_id:int):
 pid=parse_id(ingredient_id);pool=await get_pool()
 if not await pool.fetchrow("SELECT id FROM ingredients WHERE id=$1",pid):raise not_found("食材")
 rows=[dict(x) for x in await pool.fetch("SELECT a.*,i.name AS ingredient_name,i.category FROM inventory_adjustments a JOIN ingredients i ON i.id=a.ingredient_id WHERE a.ingredient_id=$1 ORDER BY a.created_at DESC,a.id DESC",pid)]
 from ..recovery import attach_merges
 return ok(await attach_merges(pool,rows,"adjustment"))
@router.get("/adjustments/{adjustment_id}/recovery-preview")
async def recovery_preview(adjustment_id:int):
 from .. import recovery
 pool=await get_pool()
 async with pool.acquire() as c, c.transaction():
  await lock_inventory_workflow(c)
  root,rows=await recovery.load(c,"adjustment",parse_id(adjustment_id))
  return ok(recovery.preview(root,rows))

@router.post("/adjustments/{adjustment_id}/revoke")
async def revoke(adjustment_id:int,request:Request):
 from .. import recovery
 aid=parse_id(adjustment_id);pool=await get_pool()
 body=await read_json_object(request, allow_empty=True)
 async with pool.acquire() as c, c.transaction():
  await lock_inventory_workflow(c)
  root,rows=await recovery.load(c,"adjustment",aid)
  await recovery.apply(c,"adjustment",aid,body,root,rows)
  iid=(rows[0]["target"] or rows[0]["source"])["id"]
  inventory=await c.fetchrow("SELECT * FROM ingredients WHERE id=$1",iid)
  a=dict(await c.fetchrow("SELECT * FROM inventory_adjustments WHERE id=$1",aid))
  await recovery.attach_merges(c,[a],"adjustment")
  return ok({"inventory":dto(inventory),"adjustment":a})
