import base from './playwright.config.mjs'
export default {...base,testIgnore:[],testMatch:'private-integrations.spec.mjs',reporter:[['list'],['json',{outputFile:'test-results/integrations.json'}]],webServer:{...base.webServer,env:{...base.webServer.env,VITE_PRIVATE_INTEGRATION_TESTING:'true'}}}
