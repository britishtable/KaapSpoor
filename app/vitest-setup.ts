import '@testing-library/jest-dom/vitest';

// jsdom's Blob/File implementation does not provide `.text()` (or
// `.arrayBuffer()`/`.stream()`); polyfill it via FileReader so tests can
// call and/or spy on `file.text()` as they would in a real browser.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function (this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
