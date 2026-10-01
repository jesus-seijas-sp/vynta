const { format } = require('../expect/format');

const MAX_AGGREGATED = 10;

const isErrorLike = (error) => error instanceof Error || typeof error?.message === 'string';

// Errors cross the worker boundary as plain objects.
function serializeError(error) {
  if (!isErrorLike(error)) {
    return { name: 'Error', message: `thrown: ${format(error, { min: true })}`, stack: '' };
  }
  const result = {
    name: error.name || 'Error',
    message: String(error.message),
    stack: typeof error.stack === 'string' ? error.stack : '',
  };
  if (error.code !== undefined) {
    result.code = String(error.code);
  }
  if (error.cause !== undefined) {
    result.cause = serializeError(error.cause);
  }
  if (Array.isArray(error.errors) && error.errors.length > 0) {
    result.errors = error.errors.slice(0, MAX_AGGREGATED).map(serializeError);
  }
  return result;
}

module.exports = { serializeError };
