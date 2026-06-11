const { MangaSource } = require('./SourceBase');

class ProtectedSource extends MangaSource {
  constructor(config, reason, options = {}) {
    super(config, options);
    this.reason = reason;
  }

  async search() {
    return this.unavailable(this.reason);
  }

  async popular() {
    return this.unavailable(this.reason);
  }

  async latest() {
    return this.unavailable(this.reason);
  }

  async details() {
    return this.unavailable(this.reason);
  }

  async chapters() {
    return this.unavailable(this.reason);
  }

  async pages() {
    return this.unavailable(this.reason);
  }
}

module.exports = ProtectedSource;
