// This space is intentionally left blank

const sinon = require("sinon");
const chai = require("chai");
const chaiAsPromisedModule = require("chai-as-promised");
const chaiAsPromised = chaiAsPromisedModule.default ?? chaiAsPromisedModule;
const expect = chai.expect;
chai.use(chaiAsPromised);
const request = require("request");

let GarageDoorOpener;

describe("GarageDoorOpener", () => {
  let log, config, homebridge;
  let garageDoorOpener;

  beforeEach(() => {
    // Homebridge passes a callable logger function with additional methods (debug/warn/error)
    log = sinon.stub();
    log.debug = sinon.stub();
    log.warn = sinon.stub();
    log.error = sinon.stub();

    config = {
      name: "Test Garage Door",
      openURL: "http://test.com/open",
      closeURL: "http://test.com/close",
      statusURL: "http://test.com/status",
    };

    const mockCharacteristic = {
      on: sinon.stub().returnsThis(),
      updateValue: sinon.stub().returnsThis(),
    };

    const mockService = {
      getCharacteristic: sinon.stub().returns(mockCharacteristic),
      setCharacteristic: sinon.stub().returnsThis(),
    };

    homebridge = {
      hap: {
        Service: {
          GarageDoorOpener: sinon.stub().returns(mockService),
          AccessoryInformation: sinon.stub().returns(mockService),
        },
        Characteristic: {
          CurrentDoorState: {
            OPEN: 0,
            CLOSED: 1,
            OPENING: 2,
            CLOSING: 3,
          },
          TargetDoorState: {
            OPEN: 0,
            CLOSED: 1,
          },
          Manufacturer: "Manufacturer",
          Model: "Model",
          SerialNumber: "SerialNumber",
          FirmwareRevision: "FirmwareRevision",
        },
      },
      registerAccessory: sinon.stub(),
    };

    // This is a bit of a hack to get the constructor from the module export
    const accessoryModule = require("../index");
    accessoryModule(homebridge);
    GarageDoorOpener = homebridge.registerAccessory.getCall(0).args[2];
    garageDoorOpener = new GarageDoorOpener(log, config);
    garageDoorOpener.service = new homebridge.hap.Service.GarageDoorOpener();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("Initialization", () => {
    it("should register accessory", () => {
      const accessoryModule = require("../index");
      accessoryModule(homebridge);
      expect(homebridge.registerAccessory.calledWith("homebridge-garage-door-shelly1", "GarageDoorOpener", sinon.match.func)).to.be.true;
    });

    it("should initialize with correct config", () => {
      expect(garageDoorOpener.name).to.equal("Test Garage Door");
      expect(garageDoorOpener.log).to.equal(log);
    });

    it("should setup services", () => {
      const services = garageDoorOpener.getServices();
      expect(services).to.be.an("array");
      expect(services.length).to.equal(2);
      expect(garageDoorOpener.service.getCharacteristic.called).to.be.true;
    });
  });

  describe("State Management", () => {
    it("should set target door state to OPEN", (done) => {
      const requestStub = sinon
        .stub(garageDoorOpener, "_httpRequest")
        .callsFake((url, body, method, callback) => callback(null, {}, ""));

      const simulateOpenStub = sinon.stub(garageDoorOpener, "simulateOpen");

      garageDoorOpener.setTargetDoorState(homebridge.hap.Characteristic.TargetDoorState.OPEN, (err) => {
        expect(err).to.equal(undefined);
        expect(requestStub.calledWith(config.openURL)).to.be.true;
        expect(simulateOpenStub.called).to.be.true;
        expect(garageDoorOpener.log.debug.calledWith("Setting targetDoorState to %s", 0)).to.be.true;
        expect(garageDoorOpener.log.calledWith("Started opening")).to.be.true;
        done();
      });
    });

    it("should set target door state to CLOSED", (done) => {
      const requestStub = sinon
        .stub(garageDoorOpener, "_httpRequest")
        .callsFake((url, body, method, callback) => callback(null, {}, ""));

      const simulateCloseStub = sinon.stub(garageDoorOpener, "simulateClose");

      garageDoorOpener.setTargetDoorState(homebridge.hap.Characteristic.TargetDoorState.CLOSED, (err) => {
        expect(err).to.equal(undefined);
        expect(requestStub.calledWith(config.closeURL)).to.be.true;
        expect(simulateCloseStub.called).to.be.true;
        expect(garageDoorOpener.log.debug.calledWith("Setting targetDoorState to %s", 1)).to.be.true;
        expect(garageDoorOpener.log.calledWith("Started closing")).to.be.true;
        done();
      });
    });
  });

  describe("Status Polling", () => {
    it("should get status and update characteristics", (done) => {
      sinon.stub(garageDoorOpener, "_fetchStatus").callsFake((callback) => callback(null, 1));

      garageDoorOpener._getStatus((err) => {
        expect(err).to.equal(undefined);
        expect(garageDoorOpener.service.getCharacteristic().updateValue.calledWith(1)).to.be.true;
        done();
      });
    });
  });

  describe("Simulations", () => {
    let clock;

    beforeEach(() => {
      clock = sinon.useFakeTimers();
    });

    afterEach(() => {
      clock.restore();
    });

    it("should simulate opening", () => {
      garageDoorOpener.movementPollInterval = 1;
      garageDoorOpener.openTime = 10;

      const fetchStub = sinon.stub(garageDoorOpener, "_fetchStatus").callsFake((cb) => cb(null, 0)); // open
      const getStatusStub = sinon.stub(garageDoorOpener, "_getStatus");

      garageDoorOpener.simulateOpen();
      expect(garageDoorOpener.isMoving).to.equal(true);
      expect(garageDoorOpener.service.getCharacteristic().updateValue.calledWith(2)).to.be.true;

      // first movement poll
      clock.tick(1000);

      expect(fetchStub.called).to.be.true;
      expect(garageDoorOpener.service.getCharacteristic().updateValue.calledWith(0)).to.be.true;
      expect(garageDoorOpener.isMoving).to.equal(false);
      expect(garageDoorOpener.log.calledWith("Detected Open state early")).to.be.true;
      expect(garageDoorOpener.log.calledWith("Finished opening")).to.be.true;

      // ensure timeout path does not trigger after early detection
      clock.tick(garageDoorOpener.openTime * 1000);
      expect(getStatusStub.called).to.be.false;
      expect(garageDoorOpener.log.calledWith("Opening time concluded, updating status")).to.be.false;
    });

    it("should simulate closing", () => {
      garageDoorOpener.movementPollInterval = 1;
      garageDoorOpener.closeTime = 10;

      const fetchStub = sinon.stub(garageDoorOpener, "_fetchStatus").callsFake((cb) => cb(null, 1)); // closed
      const getStatusStub = sinon.stub(garageDoorOpener, "_getStatus");

      garageDoorOpener.simulateClose();
      expect(garageDoorOpener.isMoving).to.equal(true);
      expect(garageDoorOpener.service.getCharacteristic().updateValue.calledWith(3)).to.be.true;

      // first movement poll
      clock.tick(1000);

      expect(fetchStub.called).to.be.true;
      expect(garageDoorOpener.service.getCharacteristic().updateValue.calledWith(1)).to.be.true;
      expect(garageDoorOpener.isMoving).to.equal(false);
      expect(garageDoorOpener.log.calledWith("Detected Closed state early")).to.be.true;
      expect(garageDoorOpener.log.calledWith("Finished closing")).to.be.true;

      // ensure timeout path does not trigger after early detection
      clock.tick(garageDoorOpener.closeTime * 1000);
      expect(getStatusStub.called).to.be.false;
      expect(garageDoorOpener.log.calledWith("Closing time concluded, updating status")).to.be.false;
    });
  });
});
