import { runKeywordAbilityBuild } from "../rules/keywordAbilityCrawler";

runKeywordAbilityBuild()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
