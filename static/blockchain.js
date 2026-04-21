// Blockchain implementation in JavaScript for the frontend
export class Block {
    constructor(index, previousHash) {
        this.index = index;
        this.timestamp = Date.now();
        this.previousHash = previousHash;
        this.data = [];
        this.nonce = '';
        this.hash = this.calculateHash();
    }

    async calculateHash() {
        const contents = JSON.stringify([
            this.index,
            this.timestamp,
            this.previousHash,
            this.data,
            this.nonce
        ]);
        return sha256(contents);
    }

    async mineBlock(difficulty) {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
        const target = '0'.repeat(difficulty);

        for (let len = 1; ; len++) {
            for (const combo of combinations(chars, len)) {
                this.nonce = combo.join('');
                this.hash = await this.calculateHash();
                if (this.hash.startsWith(target)) return;
            }
        }
    }

    // Fake mine — no difficulty, just seal the block immediately
    async fakeMine() {
        this.nonce = 'fake!'; //Exclamation mark to differentiate nonce from real mining
        this.hash = await this.calculateHash();
    }

    addBet(prediction_id, user_id, amount, is_yes) {
        this.data.push({
            prediction_id,
            user_id,
            amount,
            bet_type: is_yes ? "yes" : "no"
        });
    }
}

export class Blockchain {
    constructor() {
        this.difficulty = 4;
        this.queue = new TransactionQueue();    // pending transactions
        const genesis = this.createGenesisBlock();
        this.current = new Block(1, genesis.hash);
        this.chain = [genesis, this.current];

        // Watch queue and seal a block every time it hits 200
        this.queue.onChange = async () => {
            if (this.queue.size() >= 200) {
                await this.sealBlock();
            }
        };
    }

    createGenesisBlock() {
        return new Block(0, "0");
    }

    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }

    addBlock(newBlock) {
        newBlock.previousHash = this.getLatestBlock().hash;
        this.chain.push(newBlock);
    }

    // Pull 100 transactions from the queue, fake mine them into a block
    async sealBlock() {
        const transactions = this.queue.drain(100);
        for (const tx of transactions) {
            this.current.addBet(
                tx.prediction_id,
                tx.user_id,
                tx.amount,
                tx.bet_type === "yes"
            );
        }
        await this.current.fakeMine();
        this.addBlock(this.current);
        this.current = new Block(
            this.current.index + 1,
            this.getLatestBlock().hash
        );
    }

    // Add a bet to the queue instead of directly to the block
    async enqueueBet(prediction_id, user_id, amount, is_yes) {
        this.queue.push({
            prediction_id,
            user_id,
            amount,
            bet_type: is_yes ? "yes" : "no",
            timestamp: Date.now()
        });
    }

    isChainValid() {
        for (let i = 1; i < this.chain.length; i++) {
            const current = this.chain[i];
            const previous = this.chain[i - 1];
            if (current.hash !== current.calculateHash()) return false;
            if (current.previousHash !== previous.hash) return false;
        }
        return true;
    }

    deleteBlock(index) {
        this.chain.splice(index, 1);
        for (let i = index; i < this.chain.length; i++) {
            this.chain[i].previousHash = this.chain[i - 1].hash;
            this.chain[i].hash = this.chain[i].calculateHash();
        }
    }

    async mineCurrent() {
        await this.current.mineBlock(this.difficulty);
        this.addBlock(this.current);
        this.current = new Block(
            this.current.index + 1,
            this.getLatestBlock().hash
        );
    }
}

// Transaction Queue
// Sorted by timestamp, tiebroken by 32-bit hash of the data

class TransactionQueue {
    constructor() {
        this.transactions = [];
        this.onChange = null;       // callback set by Blockchain
    }

    push(tx) {
        tx._hash = hashCode(JSON.stringify(tx));    // compute once on insert
        this.transactions.push(tx);
        this.transactions.sort((a, b) => {
            if (a.timestamp !== b.timestamp) {
                return a.timestamp - b.timestamp;   // oldest first
            }
            return a._hash - b._hash;               // tiebreak by 32-bit hash
        });
        this.onChange?.();
    }

    // Remove and return the first n transactions
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

// Helpers

async function sha256(str) {
    const buffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(str)
    );
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// 32-bit integer hash of a string
function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;      // force 32-bit integer
    }
    return hash;
}

function* combinations(arr, len) {
    if (len === 1) {
        for (const item of arr) yield [item];
        return;
    }
    for (let i = 0; i <= arr.length - len; i++) {
        for (const rest of combinations(arr.slice(i + 1), len - 1)) {
            yield [arr[i], ...rest];
        }
    }
}