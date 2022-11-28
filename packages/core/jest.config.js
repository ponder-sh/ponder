/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    verbose: true,
    roots: ["dist"],
    testTimeout: 5_000, // 5 seconds
  };
};
