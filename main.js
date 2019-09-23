const BITNUM = 8;
const ADRLEN = 4;
let CLK;
let BUS;
let CPU;

function cloneArr(arr) {
	return arr.map((x) => (x));
}

class BusModule {
	/* Only one bus so connects to BUS by default */
	constructor(busConnectMode, busType = BUS) {
		this._busConnectMode = busConnectMode;
		busType.connectedModules.push(this);
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

	formatOutput() {
		let busConnectString;
		if (this._busConnectMode === 0) {
			busConnectString = "FLOAT";
		}
		else if (this._busConnectMode === 1) {
			busConnectString = "READ";
		}
		else {
			busConnectString = "WRITE";
		}
		return `Tristate mode: ${busConnectString}<br>
		Register value: ${this.storage.join("")}
		`;
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
		if (this.carryOutBit === 1 && !CPU.flags.ZERO) {
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

	formatOutput() {
		let busConnectString;
		if (this._busConnectMode === 0) {
			busConnectString = "FLOAT";
		}
		else if (this._busConnectMode === 1) {
			busConnectString = "READ";
		}
		else {
			busConnectString = "WRITE";
		}
		return `Tristate mode: ${busConnectString}<br>
		ALU value: ${this.storage.join("")}<br>
		Arithmetic mode: ${(this.subtractMode) ? "ADD" : "SUBTRACT"}
		`;
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

	formatOutput() {
		let busConnectString;
		if (this._busConnectMode === 0) {
			busConnectString = "FLOAT";
		}
		else if (this._busConnectMode === 1) {
			busConnectString = "READ";
		}
		else {
			busConnectString = "WRITE";
		}

		let data = this._storage.map((x, ind) => (ind + ": " + x.join("") + "<br>"));
		return `Tristate mode: ${busConnectString}<br>
		Memory: ${data.join("")}
		`;
	}

}

class Clock {
	constructor() {
		this.output = 0;
		this.mode = 0;
		this.speed;
		this.loop;
	}

	start(speed) {
		this.speed = speed;
		this.loop = setInterval(this.tick, this.speed);
	}

	halt() {
		clearInterval(this.loop);
	}

	tick() {
		this.output = +!this.output;
		if (this.output) {
			CPU.executeMicroInstruction();
		}
		else {
			CPU.zeroPins();
		}
	}

	toggleMode(mode = +!this.mode) {
		if (mode === 0) {
			this.loop = setInterval(this.tick(), this.speed);
		}
		else {
			clearInterval(this.loop);
		}
	}

	pulseClock() {
		setTimeout(() => (this.output = 0), this.speed);
	}

	formatOutput() {
		return `Mode: ${this.mode}`;
	}
}

class ControlUnit {
	constructor() {
		this.pins = {
			AI : 0,
			AO : 0,
			BI : 0,
			BO : 0,
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

		let AI  = 0b100000000000000000;
		let AO  = 0b010000000000000000;
		let BI  = 0b001000000000000000;
		let BO  = 0b000100000000000000;
		let OI  = 0b000010000000000000;
		let OO  = 0b000001000000000000;
		let SO  = 0b000000100000000000;
		let SU  = 0b000000010000000000;
		let MAI = 0b000000001000000000;
		let RI  = 0b000000000100000000;
		let RO  = 0b000000000010000000;
		let PCI = 0b000000000001000000;
		let PCO = 0b000000000000100000;
		let PCC = 0b000000000000010000;
		let II  = 0b000000000000001000;
		let IO  = 0b000000000000000100;
		let YLD = 0b000000000000000010;
		let HLT = 0b000000000000000001;

		this.instructionSet = [
			[[PCO + MAI, RO + II + PCC, IO + MAI, RO + AI, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RO + AI, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RO + AI, YLD]], //LDA
			[[PCO + MAI, RO + II + PCC, IO + MAI, RO + AO, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RO + AO, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RO + AO, YLD]], //LDO
			[[PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + AI, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + AI, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + AI, YLD]], //ADDA
			[[PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + OI, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + OI, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + OI, YLD]],//ADDO
			[[PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + AI + SU, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + AI + SU, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + AI + SU, YLD]],//SUBA
			[[PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + OI + SU, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + OI + SU, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RO + BI, SO + OI + SU, YLD]],//SUBO
			[[PCO + MAI, RO + II + PCC, IO + MAI, RI + AO, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RI + AO, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RI + AO, YLD]],//STOA
			[[PCO + MAI, RO + II + PCC, IO + MAI, RI + OO, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RI + OO, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, RI + OO, YLD]],//STOO
			[[PCO + MAI, RO + II + PCC, IO + MAI, AO + OI, BO + AI, OO + BI, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, AO + OI, BO + AI, OO + BI, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, AO + OI, BO + AI, OO + BI, YLD]],//SWAB
			[[PCO + MAI, RO + II + PCC, IO + MAI, AO + BI, OO + AI, BO + OI, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, AO + OI, BO + AI, OO + BI, YLD], [PCO + MAI, RO + II + PCC, IO + MAI, AO + OI, BO + AI, OO + BI, YLD]], //SWAO
			[[PCO + MAI, RO + II + PCC, YLD], [PCO + MAI, RO + II + PCC, IO + PCI, YLD], [PCO + MAI, RO + II + PCC, YLD]], //JMPZ
			[[PCO + MAI, RO + II + PCC, YLD], [PCO + MAI, RO + II + PCC, YLD], [PCO + MAI, RO + II + PCC, IO + PCI, YLD]], //JMPC
			[[PCO + MAI, RO + II + PCC, HLT], [PCO + MAI, RO + II + PCC, HLT], [PCO + MAI, RO + II + PCC, HLT]] //HLT
		];

		/* Current instruction held in instruction register */
		this.instruction = [0, 0, 0, 0, 0, 0, 0, 0];
		this.microInstructionCount = 0;

		this.instructionWords = { LDA: "0000", LDO: "0001", ADDA: "0010", ADDO: "0011", SUBA: "0100", SUBO: "0101", STOA: "0110", STOO: "0111", SWAB: "1000", SWAO: "1001", JMPZ: "1010", JMPC: "1011", HLT: "1100"};

	}

	/* Triggered on rising edge of clock */
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
			console.log(this.connectedModules.RAM._storage[13]);
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

	/* Acts as getter for instruction set */
	fetchMicroInstruction() {
		let instrAdr = parseInt(this.instruction.slice(0, 4).join(""), 2);
		let microInstr;
		let flag = this.flags.CARRY * 2 + this.flags.ZERO;
		microInstr = (this.instructionSet[instrAdr][flag][this.microInstructionCount] + (1 << this.pinNumber)).toString(2).split("");
		microInstr.shift();
		return microInstr;
	}

	executeMicroInstruction() {
		let microInstr = this.fetchMicroInstruction();
		//console.log(microInstr.map((pinVal, ind) => (Object.keys(this.pins)[ind] + ": " + pinVal)).join(", "));
		microInstr.forEach((pinValue, ind) => {
			let key = Object.keys(this.pins)[ind];
			this.pins[key] = +pinValue;
		});

		if (this.pins.YLD) {
			this.microInstructionCount = 0;
			console.log(PC.getValue());
		}
		else {
			this.updateAllPins();
			this.microInstructionCount++;
		}
	}

	/* Converts assembly code into machine code */
	assembleCode(assemblyCode) {
		assemblyCode = assemblyCode.replace(/<br>/g, "");
		let commandArr = assemblyCode.split(/;\s+|;/);
		for (let i in commandArr) {
			/* Converts instruction word into machine instruction */
			commandArr[i] = commandArr[i].split(" ");
			commandArr[i][0] = this.instructionWords[commandArr[i][0]];

			/* For HLT command, writes 0 to address */
			if (commandArr[i].length === 1) {
				commandArr[i][1] = "0x0";
			}

			/* Formats address from hex code to 8 bit binary number */
			commandArr[i][1] = (parseInt(commandArr[i][1])).toString(2);
			commandArr[i][1] = ((1 << ADRLEN - commandArr[i][1].length).toString(2) + commandArr[i][1]).slice(1);
			commandArr[i] = ((commandArr[i][0] + commandArr[i][1]).split("")).map((x) => (parseInt(x)));
		}
		console.log(commandArr);
		return commandArr;
	}


	programComputer(assemblyCode, data) {
		let machineCode = this.assembleCode(assemblyCode);
		for (let i in machineCode) {
			this.connectedModules["RAM"]._storage[i] = machineCode[i];
		}
		for (let i in data) {
			this.connectedModules["RAM"]._storage[parseInt(data[i][1])] = (data[i][0].split("")).map((x) => (parseInt(x)));
		}
	}

	startComputer(clockSpeed) {
		this.connectedModules["CLK"].start(clockSpeed);
	}

	displayModuleOutputs() {
		let output = {};
		for (let module of Object.keys(this.connectedModules)) {
			output[module] = this.connectedModules[module].formatOutput();
		}
		output.CPU = `MicroInstruction: ${this.microInstructionCount}<br>
		Instruction: ${this.instruction}<br>
		Carry Flag: ${this.flags.CARRY}<br>
		Zero Flag: ${this.flags.ZERO}`;

		return output;
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

CLK = new Clock();

function buildComputer() {
	CPU.connectedModules["A"] = A;
	CPU.connectedModules["B"] = B;
	CPU.connectedModules["O"] = O;
	CPU.connectedModules["RAM"] = RAM;
	CPU.connectedModules["ADR"] = ADR;
	CPU.connectedModules["ALU"] = ALU;
	CPU.connectedModules["PC"] = PC;
	CPU.connectedModules["IR"] = IR;
	CPU.connectedModules["CLK"] = CLK;
}

//buildComputer();

//CPU.startComputer(50);