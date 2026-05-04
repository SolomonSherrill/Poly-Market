export class Block {
    constructor(index, previousHash) {
        this.index = index;
        this.timestamp = Date.now();
        this.previousHash = previousHash;
        this.data = [];
        this.nonce = "";
        this.hash = this.calculateHash();
    }

    calculateHash() {
        const contents = JSON.stringify([
            this.index,
            this.timestamp,
            this.previousHash,
            this.data,
            this.nonce,
        ]);
        return stableHexHash(contents);
    }

    mineBlock(difficulty) {
        const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
        const target = "0".repeat(difficulty);

        for (let len = 1; ; len++) {
            for (const combo of combinations(chars, len)) {
                this.nonce = combo.join("");
                this.hash = this.calculateHash();
                if (this.hash.startsWith(target)) {
                    return;
                }
            }
        }
    }

    fakeMine() {
        this.nonce = "fake!";
        this.hash = this.calculateHash();
    }

    addTransaction(transaction) {
        this.data.push({
            ...transaction,
        });
    }
}

export class Blockchain {
    constructor() {
        this.difficulty = 4;
        this.queue = new TransactionQueue();
        const genesis = this.createGenesisBlock();
        this.current = new Block(1, genesis.hash);
        this.chain = [genesis, this.current];

        this.queue.onChange = () => {
            if (this.queue.size() >= 200) {
                this.sealBlock();
            }
        };
    }

    export(){
        return {
            difficulty: this.difficulty,
            chain: this.chain, 
            current: this.current,
            queue: this.queue.transactions,
        }
    }

    import(data) {
        this.difficulty = data.difficulty;
        this.chain = data.chain;
        this.current = data.current;
        this.queue.transactions = data.queue;
    }

    createGenesisBlock() {
        return new Block(0, "0");
    }

    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }

    addBlock(newBlock) {
        newBlock.previousHash = this.getLatestBlock().hash;
        newBlock.hash = newBlock.calculateHash();
        this.chain.push(newBlock);
    }

    sealBlock() {
        const transactions = this.queue.drain(100);
        for (const tx of transactions) {
            this.current.addTransaction(tx);
        }

        this.current.fakeMine();
        this.addBlock(this.current);
        this.current = new Block(this.current.index + 1, this.getLatestBlock().hash);
    }

    enqueueEvent(eventType, payload = {}) {
        this.queue.push({
            event_type: eventType,
            ...payload,
        });
    }

    isChainValid() {
        for (let i = 1; i < this.chain.length; i++) {
            const current = this.chain[i];
            const previous = this.chain[i - 1];
            if (current.hash !== current.calculateHash()) {
                return false;
            }
            if (current.previousHash !== previous.hash) {
                return false;
            }
        }

        return true;
    }

    deleteBlock(index) {
        this.chain.splice(index, 1);
        for (let i = Math.max(index, 1); i < this.chain.length; i++) {
            this.chain[i].previousHash = this.chain[i - 1].hash;
            this.chain[i].hash = this.chain[i].calculateHash();
        }
    }

    mineCurrent() {
        this.current.mineBlock(this.difficulty);
        this.addBlock(this.current);
        this.current = new Block(this.current.index + 1, this.getLatestBlock().hash);
    }
}

export class TransactionQueue {
    constructor() {
        this.transactions = [];
        this.onChange = null;
    }

    push(tx) {
        tx._hash = hashCode(JSON.stringify(tx));
        this.transactions.push(tx);
        this.transactions.sort((a, b) => {
            if (a.timestamp !== b.timestamp) {
                return a.timestamp - b.timestamp;
            }
            return a._hash - b._hash;
        });
        this.onChange?.();
    }

    drain(n) {
        return this.transactions.splice(0, n);
    }

    size() {
        return this.transactions.length;
    }

    peek() {
        return this.transactions[0] ?? null;
    }
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

function stableHexHash(str) {
    const seedA = hashCode(str);
    const seedB = hashCode(`${str}|b`);
    const seedC = hashCode(`${str}|c`);
    const seedD = hashCode(`${str}|d`);

    return [seedA, seedB, seedC, seedD]
        .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
        .join("");
}

function* combinations(arr, len) {
    if (len === 1) {
        for (const item of arr) {
            yield [item];
        }
        return;
    }

    for (let i = 0; i <= arr.length - len; i++) {
        for (const rest of combinations(arr.slice(i + 1), len - 1)) {
            yield [arr[i], ...rest];
        }
    }
}