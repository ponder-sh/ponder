/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    verbose: true,
    roots: ["dist"],
    testTimeout: 60_000, // 60 seconds
  };
};
