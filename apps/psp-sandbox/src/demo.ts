import { ProviderSandbox } from "./provider-simulator.ts";

const sandbox = new ProviderSandbox();
sandbox.loadGoldenScenario();
console.log(JSON.stringify(sandbox.resolveTransaction("T1001", "case-golden-001"), null, 2));

