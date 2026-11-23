/**
 * Entry point. Monitoring starts before the app registers, so the global
 * error handlers are in place before the first screen renders.
 * (Imports run first; anything logged while modules load waits in the logger's buffer.)
 */
import { initMonitoring } from './src/app/monitoring/initMonitoring';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

initMonitoring();
AppRegistry.registerComponent(appName, () => App);
