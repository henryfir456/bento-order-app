exports.deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
exports.flush = async () => {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
};
