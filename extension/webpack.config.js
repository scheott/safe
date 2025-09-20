const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'development',
  devtool: false,
  entry: {
    content: './src/content/content.js',
    popup: './src/popup/popup.js'
    // Remove background from webpack entry - we'll copy it directly
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true
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