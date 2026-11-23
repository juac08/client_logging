const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Lets the POC import '@poc/common' and '@poc/api' exactly like packages in your
 * monorepo, while the code lives in src/common and src/api of this single app.
 */
const config = {
  resolver: {
    extraNodeModules: {
      '@poc/common': path.resolve(__dirname, 'src/common'),
      '@poc/api': path.resolve(__dirname, 'src/api'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
