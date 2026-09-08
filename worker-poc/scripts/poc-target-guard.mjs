import fs from 'node:fs';

const formalConfigUrl = new URL('../wrangler.jsonc', import.meta.url);
const pocConfigUrl = new URL('../wrangler-poc.jsonc', import.meta.url);

const readConfig = (url) => JSON.parse(fs.readFileSync(url, 'utf8'));

const d1Binding = (config) => config?.d1_databases?.find((binding) => binding.binding === 'DB');

export const assertPocTargetIsLocalOnly = ({
  formalConfig = readConfig(formalConfigUrl),
  pocConfig = readConfig(pocConfigUrl)
} = {}) => {
  const formalD1 = d1Binding(formalConfig);
  const pocD1 = d1Binding(pocConfig);

  if (!pocConfig?.name || pocConfig.name === formalConfig?.name) {
    throw new Error('Unsafe POC target: the legacy POC Worker name must differ from the formal Worker name.');
  }
  if (!pocD1?.database_name) {
    throw new Error('Unsafe POC target: the legacy POC must declare a local-only D1 database name.');
  }
  if (pocD1.database_name === formalD1?.database_name) {
    throw new Error('Unsafe POC target: the legacy POC D1 database name matches the formal D1 database.');
  }
  if (pocD1.database_id) {
    if (pocD1.database_id === formalD1?.database_id) {
      throw new Error('Unsafe POC target: the legacy POC D1 database ID matches the formal D1 database.');
    }
    throw new Error('Unsafe POC target: local-only POC configuration must not declare any D1 database ID.');
  }

  return {
    pocWorkerName: pocConfig.name,
    pocDatabaseName: pocD1.database_name
  };
};

export const assertPocRemoteOperationBlocked = () => {
  const target = assertPocTargetIsLocalOnly();
  throw new Error(
    `Refusing remote POC operation: ${target.pocWorkerName} is local-only and has no remote D1 target. `
    + 'Use the explicit --local POC commands for isolated verification.'
  );
};
