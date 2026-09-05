function ok(res, data, meta) {
  const body = { data }
  if (meta !== undefined) body.meta = meta
  return res.json(body)
}

function created(res, data) {
  return res.status(201).json({ data })
}

module.exports = {
  ok,
  created,
}
