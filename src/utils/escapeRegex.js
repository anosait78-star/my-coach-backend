// Escapes user-supplied text so it is treated as a literal inside a RegExp,
// preventing ReDoS and regex-injection through search inputs.
module.exports = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
