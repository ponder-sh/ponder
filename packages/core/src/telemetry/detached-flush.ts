async function detachedFlush() {
  const args = [...process.argv];
  console.log(args);
}

detachedFlush()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
