class Base {
  static create() {
    return new this();
  }

  hello() {
    return 'hello';
  }
}

class Factory extends Base {
  static text(value) {
    return { text: value };
  }
}

class Container {
  constructor() {
    this.items = {};
  }

  get(name) {
    return this.items[name];
  }
}

module.exports = { Factory, ioc: new Container() };
