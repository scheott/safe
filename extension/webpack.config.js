const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'development',
  devtool: 'cheap-module-source-map', // Changed from false - MV3 compatible
  entry: {
    content: './src/content/content.js',
    popup: './src/popup/popup.js'
    // Note: background is NOT here - we copy it directly
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true
  },
  optimization: {
    minimize: false, // Keep readable for development
    concatenateModules: false // Avoid eval() in concatenation
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'public/manifest.json', to: 'manifest.json' },
        { from: 'src/popup/popup.html', to: 'popup.html' },
        { from: 'src/background/background.js', to: 'background.js' } // Copy directly, no webpack processing
      ]
    })
  ],
  resolve: {
    extensions: ['.js']
  }
};