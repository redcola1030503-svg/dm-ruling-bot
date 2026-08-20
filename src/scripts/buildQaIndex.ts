import { runQaIndexBuild } from "../rules/qaIndexCrawler";

runQaIndexBuild()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
