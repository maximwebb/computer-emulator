const BITNUM = 8;
const ADRLEN = 4;
let CLK;
let BUS;
let CPU;

function cloneArr(arr) {
	return arr.map((x) => (x));
}

class BusModule {
	constructor(busConnectMode) {
		this._busConnectMode = busConnectMode;
		BUS.connectedModules.push(this);
	}
}


class Register extends BusModule {
	constructor(busConnectMode) {
		super(busConnectMode);
		/* 0 = FLOAT, 1 = READ, 2 = WRITE */
		this.storage = (new Array(BITNUM)).fill(0);
	}

	updateState() {
		if (this._busConnectMode === 1) {
			this.storage = BUS.read();
		}
		else if (this._busConnectMode === 2) {
			BUS.write(this.storage);
		}
	}

	/* OUT defaults to 0 for write-only registers */
	updateControlPins(IN, OUT = 0) {
		if (IN) this.busConnectMode = 1;
		else if (OUT) this.busConnectMode = 2;
		else this.busConnectMode = 0;
	}

	get busConnectMode() {
		return this._busConnectMode;
	}

	set busConnectMode(mode) {
		this._busConnectMode = mode;
		this.updateState();
	}
}

class Alu extends Register {
	constructor() {
		super(0);
		this.subtractMode = 0;
		this.carryInBit = 0;
		this.carryOutBit = 1;
		this.regA = A.storage;
		this.regB = B.storage;
	}

	updateState() {
		if (this._busConnectMode === 2) {
			BUS.write(this.storage);
		}
	}

	updateControlPins(OUT, SUB) {
		this.subtractMode = SUB;
		if (OUT) {
			this.computeOutput();
			this.busConnectMode = 2;
		}
	}

	computeOutput() {
		this.regA = A.storage;
		this.regB = cloneArr(B.storage);

		/* Converts B register to two's complement */
		if (this.subtractMode) {
			this.regB = this.regB.map((x) => (+!x));
			this.carryInBit = 1;
		}
		else {
			this.carryInBit = 0;
		}
		this.carryOutBit = this.carryInBit;
		for (let i = 0; i < BITNUM; i++) {
			let bitA = this.regA[BITNUM - 1 - i];
			let bitB = this.regB[BITNUM - 1 - i];
			this.storage[BITNUM - 1 - i] = (bitA ^ bitB) ^ this.carryOutBit;
			this.carryOutBit = ((bitA ^ bitB) & this.carryOutBit) | (bitA & bitB);
		}

		/* Sets relevant flags after performing calculation */
		if (this.storage.reduce((x, y) => (x + y)) === 0) {
			CPU.flags.ZERO = 1;
		}
		if (this.carryOutBit === 1) {
			CPU.flags.CARRY = 1;
		}
	}

	set busConnectMode(mode) {
		if (mode === 1) {
			console.error("ALU cannot read from BUS");
		}
		else {
			this._busConnectMode = mode;
			this.updateState();
		}
	}
}

/* Register used for addresses - only 4 LSBs are used. */
class AddressRegister extends Register {
	constructor(memoryModule) {
		super(0);
		this._storage = (new Array(BITNUM)).fill(0);
		this.memoryModule = memoryModule;
	}

	updateState() {
		/* Workaround for infinite loop when RAM writes to bus */
		if (this._busConnectMode === 1) {
			this.storage = BUS.read();
		}
		/* Shouldn't normally be called */
		else if (this._busConnectMode === 2) {
			/* Writes 4LSBs to BUS only */
			BUS.write(this.storage.slice(BITNUM - ADRLEN, BITNUM));
		}
	}

	get storage() {
		return this._storage.slice(BITNUM - ADRLEN, BITNUM);
	}

	set storage(data) {
		this._storage = data;
		if (this.memoryModule) {
			this.memoryModule.currentAddress = this.storage.join("");
		}
	}
}

class InstructionRegister extends Register {
	constructor() {
		super(0);
		this._storage = (new Array(BITNUM)).fill(0);
	}

	get storage() {
		return this._storage;
	}

	set storage(data) {
		this._storage = data;
		CPU.instruction = data;
	}
}

class ProgramCounter extends Register {
	constructor() {
		super(0);
	}

	increment() {
		for (let i = this.storage.length - 1; i >= 0; i--) {
			if (this.storage[i] ^= 1) return 0;
		}
	}

	getValue() {
		return parseInt(this.storage.join(""), 2);
	}

	updateControlPins(IN, OUT, COUNT) {
		if (IN) this.busConnectMode = 1;
		else if (OUT) this.busConnectMode = 2;
		else this.busConnectMode = 0;

		if (COUNT) {
			this.increment();
			CPU.pins.PCC = 0;
		}
	}
}

class Memory extends BusModule {
	constructor(busConnectMode, pages) {
		super(busConnectMode);
		if (pages > ADRLEN) {
			throw "Maximum memory size exceeded.";
		}
		this._storage = [];
		for (let i = 0; i < 2**pages; i++) {
			this._storage.push((new Array(BITNUM)).fill(0));
		}
		/* currentAddress is handled by Address Register. */
		this.currentAddress = 0;
	}

	updateState() {
		if (this.busConnectMode === 1) {
			this.storage = [...BUS];
		}

		else if (this.busConnectMode === 2) {
			BUS.write(this.storage);
		}
	}

	updateControlPins(IN, OUT) {
		if (IN) this.busConnectMode = 1;
		else if (OUT) this.busConnectMode = 2;
		else this.busConnectMode = 0;
	}

	get storage() {
		let adr = parseInt(this.currentAddress.toString(), 2);
		return this._storage[adr];
	}

	set storage(data) {
		let adr = parseInt(this.currentAddress.toString(), 2);
		this._storage[adr] = data;
	}

	get busConnectMode() {
		return this._busConnectMode;
	}

	set busConnectMode(mode) {
		this._busConnectMode = mode;
		this.updateState();
	}
}

class Clock {
	constructor(command, speed) {
		this.output = 0;
		this.command = command;
		this.mode = 0;
		this.speed = speed;
		this.loop = setInterval(this.command, this.speed);
	}

	toggleMode(mode = +!this.mode) {
		if (mode === 0) {
			this.loop = setInterval(this.command, this.speed);
		}
		else {
			clearInterval(this.loop);
		}
	}

	pulseClock() {
		setTimeout(() => (this.output = 0), this.speed);
	}

	halt() {
		clearInterval(this.loop);
	}
}

class ControlUnit {
	constructor() {
		this.pins = {
			AI : 0,
			AO : 0,
			BI : 0,
			OI : 0,
			OO : 0,
			SO : 0,
			SU : 0,
			MAI : 0,
			RI : 0,
			RO : 0,
			PCI : 0,
			PCO : 0,
			PCC : 0, //Increments counter
			II : 0,
			IO : 0,
			YLD : 0,
			HLT : 0
		};

		this.pinNumber = Object.keys(this.pins).length;

		this.flags = {
			CARRY: 0,
			ZERO: 0
		};

		this.connectedModules = {};

		let AI  = 0b10000000000000000;
		let AO  = 0b01000000000000000;
		let BI  = 0b00100000000000000;
		let OI  = 0b00010000000000000;
		let OO  = 0b00001000000000000;
		let SO  = 0b00000100000000000;
		let SU  = 0b00000010000000000;
		let MAI = 0b00000001000000000;
		let RI  = 0b00000000100000000;
		let RO  = 0b00000000010000000;
		let PCI = 0b00000000001000000;
		let PCO = 0b00000000000100000;
		let PCC = 0b00000000000010000;
		let II  = 0b00000000000001000;
		let IO  = 0b00000000000000100;
		let YLD = 0b00000000000000010;
		let HLT = 0b00000000000000001;

		this.instructionSet = [
			[PCO + MAI, RO + II + PCC, IO + MAI, RO + AI, YLD], //LDA
			[PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + AI, YLD], //ADDA
			[PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + OI, YLD], //ADDO
			[PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + AI + SU, YLD], //SUBA
			[PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + OI + SU, YLD], //SUBO
			[PCO + MAI, RO + II + PCC, IO + MAI, RI + AO, YLD], //STOA
			[PCO + MAI, RO + II + PCC, IO + MAI, RI + OO, YLD], //STOO
			[PCO + MAI, RO + II + PCC, HLT] //HLT
		];

		/* Current instruction held in instruction register */
		this.instruction = [0, 0, 0, 0, 0, 0, 0, 0];
		this.microInstructionCount = 0;
	}

	updateAllPins() {
		this.connectedModules["ALU"].updateControlPins(this.pins.SO, this.pins.SU);
		this.connectedModules["A"].updateControlPins(this.pins.AI, this.pins.AO);
		this.connectedModules["B"].updateControlPins(this.pins.BI);
		this.connectedModules["O"].updateControlPins(this.pins.OI, this.pins.OO);
		this.connectedModules["RAM"].updateControlPins(this.pins.RI, this.pins.RO);
		this.connectedModules["PC"].updateControlPins(this.pins.PCI, this.pins.PCO, this.pins.PCC);
		this.connectedModules["ADR"].updateControlPins(this.pins.MAI);
		this.connectedModules["IR"].updateControlPins(this.pins.II, this.pins.IO);

		if (this.pins.HLT) {
			console.log(logger.next().value);
			CLK.halt();
		}
	}

	/* Triggered on falling edge of clock */
	zeroPins() {
		for (let i of Object.keys(this.pins)) {
			this.pins[i] = 0;
		}
		this.updateAllPins();
	}

	fetchMicroInstruction() {
		let instrAdr = parseInt(this.instruction.slice(0, 4).join(""), 2);
		let microInstr = (this.instructionSet[instrAdr][this.microInstructionCount] + (1 << this.pinNumber)).toString(2).split("");
		microInstr.shift();
		return microInstr;
	}

	executeMicroInstruction() {
		let microInstr = this.fetchMicroInstruction();
		console.log(microInstr.map((pinVal, ind) => (Object.keys(this.pins)[ind] + ": " + pinVal)).join(", "));
		microInstr.forEach((pinValue, ind) => {
			let key = Object.keys(this.pins)[ind];
			this.pins[key] = +pinValue;
		});

		if (this.pins.YLD) {
			console.log(logger.next().value);
			this.microInstructionCount = 0;
			console.log(PC.getValue());
		}
		else {
			this.updateAllPins();
			this.microInstructionCount++;
		}

		//console.log(microInstr.map((pinVal, ind) => (Object.keys(this.pins)[ind] + ": " + pinVal)).join(", "));
	}

}

class Bus extends Array {
	constructor() {
		super();
		this.push(...(new Array(BITNUM)).fill(0));
		this.connectedModules = [];
	}

	read() {
		return [...this];
	}

	write(dataArr) {
		if (dataArr.length > BITNUM) {
			console.error("Attempted to write too many values to bus.")
		}
		for (let i = 1; i <= dataArr.length; i++) {
			this[BITNUM - i] = dataArr[dataArr.length - i];
		}
	}
}

let busHandler = {
	set(obj, prop, val) {
		Reflect.set(...arguments);
		for (let module of obj.connectedModules) {
			if (module._busConnectMode === 1) {
				module.updateState();
			}
		}
		return true;
	}
};

bus = new Bus();
BUS = new Proxy(bus, busHandler);

let A = new Register(0);
let B = new Register(0);
let O = new Register(0);
let RAM = new Memory(0, 4);
ADR = new AddressRegister(RAM);
ALU = new Alu();
PC = new ProgramCounter();
CPU = new ControlUnit();
IR = new InstructionRegister();

CLK = new Clock(function() {
	this.output = +!this.output;
	if (this.output) {
		CPU.executeMicroInstruction();
	}
	else {
		CPU.zeroPins();
	}
}, 100);

function buildComputer() {
	CPU.connectedModules["A"] = A;
	CPU.connectedModules["B"] = B;
	CPU.connectedModules["O"] = O;
	CPU.connectedModules["RAM"] = RAM;
	CPU.connectedModules["ADR"] = ADR;
	CPU.connectedModules["ALU"] = ALU;
	CPU.connectedModules["PC"] = PC;
	CPU.connectedModules["IR"] = IR;
}

function* logInfo() {
	yield "Register A loaded with: " + A.storage;
	yield "Register B loaded with: " + B.storage;
	yield "Register A loaded with: " + A.storage;
	yield "Result of computation: " + RAM._storage[13].join("");
}

let logger = logInfo();

/* Write program */
RAM._storage[0] = [0, 0, 0, 0, 1, 1, 1, 1];
RAM._storage[1] = [0, 1, 0, 0, 1, 1, 1, 0];
RAM._storage[2] = [0, 1, 1, 0, 1, 1, 0, 1];
RAM._storage[3] = [0, 1, 1, 1, 0, 0, 0, 0];

RAM._storage[15] = [0, 0, 0, 0, 0, 1, 0, 1];
RAM._storage[14] = [0, 0, 0, 0, 0, 0, 1, 1];


buildComputer();