class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function notFound(resource = '资源') {
  return new HttpError(404, 'NOT_FOUND', `${resource}不存在`)
}

module.exports = {
  HttpError,
  notFound,
}
