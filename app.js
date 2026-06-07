renderDashboard([]); // Immediate fallback render
import { db, push, ref, onValue, remove, update } from "./firebase.js";
import { saveOfflineTransaction, getOfflineTransactions } from "./storage.js";

// TOP OF app.js
const container = document.getElementById("app");


// ----------------------------
// UTIL
// ----------------------------

function safeNumber(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function uid(item) {
  return item?.tid || item?.id || item?.message || JSON.stringify(item);
}

// ----------------------------
// PARSER (FIXED + UPGRADED)
// ----------------------------

function parseTransaction(message) {
  if (!message || typeof message !== "string") return null;

  const msg = message.toLowerCase();

  let network = "unknown";
  let type = "other";

  // NETWORK DETECTION
  if (
    msg.includes("received mwk") ||
    msg.includes("has deposited") ||
    msg.includes("pp")
  ) {
    network = "airtel";
  } else if (
    msg.includes("mpamba") ||
    msg.includes("tnm")
  ) {
    network = "tnm";
  }

  // TYPE DETECTION
  if (msg.includes("betpawa") || msg.includes("premierbet")) type = "gambling";
  else if (msg.includes("airtime")) type = "airtime";
  else if (msg.includes("deposited") || msg.includes("received")) type = "income";
  else if (msg.includes("sent") || msg.includes("paid") || msg.includes("withdrawn")) type = "expense";

  // AMOUNT EXTRACTION
  const amountMatch = message.match(/(?:MK|MWK)\s?([\d,]+)/i);
  const amount = amountMatch ? safeNumber(amountMatch[1].replace(/,/g, "")) : 0;

  // SENDER EXTRACTION
  let sender = "System";
  const senderMatch =
    message.match(/^(.*?) has deposited/i) ||
    message.match(/from (.*?)\s\d+/i);

  if (senderMatch) sender = senderMatch[1].trim();

  // TID EXTRACTION
  const tidMatch = message.match(/([A-Z]{2}\d+\.\d+\.[A-Z0-9]+)/i);
  const tid = tidMatch ? tidMatch[1] : `NO_TID_${amount}_${Date.now()}`;

  // ----------------------------
  // SAVINGS ENGINE (AUTO-APPROVED)
  // ----------------------------

  let savingsPercent = 0;
  let saveAmount = 0;
  let savingsStatus = "denied";
  let requiresTransfer = false;

  if (type === "income" && amount > 0) {
    savingsPercent = amount > 20000 ? 25 : amount > 5000 ? 35 : 40;
    saveAmount = Math.floor(amount * (savingsPercent / 100));

    // AUTO-APPROVE ALL INCOME SAVINGS >= 100 MK
    if (saveAmount >= 100) {
      savingsStatus = "approved";
      requiresTransfer = true; // AUTO-APPROVED AND READY FOR TRANSFER
    } else {
      savingsStatus = "pending";
      requiresTransfer = false;
    }
  }

  return {
    id: tid,
    network,
    type,
    amount,
    sender,
    tid,
    savingsPercent,
    saveAmount,
    savingsStatus,
    requiresTransfer,
    rawMessage: message,
    timestamp: Date.now(),
    processed: false
  };
}

// ----------------------------
// ANALYTICS ENGINE (FIXED)
// ----------------------------

function analyze(transactions) {
  let income = 0;
  let expense = 0;
  let approvedSavings = 0;
  let pendingSavings = 0;
  let count = 0;
  let biggest = 0;
  let cards = [];
  const seen = new Set();

  for (const item of transactions) {
    const parsed = parseTransaction(item.message);
    if (!parsed) continue;

    // PREVENT DUPLICATES
    if (seen.has(parsed.tid)) continue;
    seen.add(parsed.tid);

    count++;
    biggest = Math.max(biggest, parsed.amount);

    if (parsed.type === "income") {
      income += parsed.amount;

      if (parsed.savingsStatus === "approved") {
        approvedSavings += parsed.saveAmount;
      }

      if (parsed.savingsStatus === "pending") {
        pendingSavings += parsed.saveAmount;
      }
    }

    if (["expense", "gambling", "airtime"].includes(parsed.type)) {
      expense += parsed.amount;
    }

    cards.push(parsed);
  }

  const balance = income - expense;

  return {
    income,
    expense,
    balance,
    approvedSavings,
    pendingSavings,
    count,
    biggest,
    cards
  };
}

// ----------------------------
// PREDICTION ENGINE
// ----------------------------

function predict(balance, income, expense) {
  const trend = income - expense;
  const projected = balance + (trend * 7);

  let risk =
    projected < balance * 0.5
      ? "HIGH RISK"
      : projected < balance
      ? "MEDIUM RISK"
      : "LOW RISK";

  return { projected, risk };
}

// ----------------------------
// RENDER (FULL RESTORED DASHBOARD)
// ----------------------------

function renderDashboard(dataArray = []) {
  const data = analyze(dataArray);
  const prediction = predict(data.balance, data.income, data.expense);
  const savingsBalance = data.approvedSavings;

  let insight = "";

  if (prediction.risk === "HIGH RISK") {
    insight = "⚠ Your financial future is unstable based on spending pattern.";
  } else if (data.approvedSavings > data.expense) {
    insight = "🔥 Strong saver. Your savings exceed your spending.";
  } else {
    insight = "📊 Stable but can improve savings consistency.";
  }

  container.innerHTML = `
    <div class="hero">

      <div class="hero-top">
        <h1>Money Saver Pro</h1>
        <p>Level 4 Full Financial Intelligence System - Auto-Approval Enabled</p>
      </div>

      <div class="balance-card">
        <span>Savings Balance</span>
        <h2>MK ${savingsBalance.toLocaleString()}</h2>
      </div>

      <div class="stats-grid">

        <div class="stat-card income">
          <span>Total Income</span>
          <strong>MK ${data.income.toLocaleString()}</strong>
        </div>

        <div class="stat-card expense">
          <span>Total Expenses</span>
          <strong>MK ${data.expense.toLocaleString()}</strong>
        </div>

        <div class="stat-card savings">
          <span>Auto-Approved Savings</span>
          <strong>MK ${data.approvedSavings.toLocaleString()}</strong>
        </div>

        <div class="stat-card pending">
          <span>Below Threshold</span>
          <strong>MK ${data.pendingSavings.toLocaleString()}</strong>
        </div>

      </div>

      <div class="insight-card">
        <h3>AI Insight</h3>
        <p>${insight}</p>
      </div>

      <div class="insight-card">
        <h3>Prediction</h3>
        <p>
          7-Day Forecast: MK ${prediction.projected.toLocaleString()} <br>
          Risk Level: ${prediction.risk}
        </p>
      </div>

      <div class="insight-card">
        <h3>Overview</h3>
        <p>
          Transactions: ${data.count} <br>
          Biggest Transaction: MK ${data.biggest.toLocaleString()}
        </p>
      </div>

    </div>

    <div class="transactions">

      ${data.cards.map(p => `
        <div class="card ${p.type}">

          <div class="card-top">
            <div>
              <div class="sender">${p.sender}</div>
              <div class="type">${p.type}</div>
            </div>

            <div class="amount">
              MK ${p.amount.toLocaleString()}
            </div>
          </div>

          <div class="meta-grid">

            <div class="meta-box">
              <span>Savings %</span>
              <strong>${p.savingsPercent}%</strong>
            </div>

            <div class="meta-box">
              <span>Savings</span>
              <strong>MK ${p.saveAmount.toLocaleString()}</strong>
            </div>

            <div class="meta-box">
              <span>Status</span>
              <strong class="${p.savingsStatus === 'approved' ? 'approved' : 'pending'}">${p.savingsStatus}</strong>
            </div>

          </div>

          <div class="raw-message">
            ${p.rawMessage}
          </div>

          ${p.requiresTransfer ? `
            <div class="transfer-info" style="color: green; font-weight: bold; margin-top: 10px;">
              ✅ Auto-Approved - Waiting for Macrodroid (MK ${p.saveAmount})
            </div>
          ` : ""}

        </div>
      `).join("")}

    </div>
  `;
}

// ----------------------------
// FIREBASE: PENDING TRANSFERS (For Macrodroid)
// ----------------------------

const pendingTransfersRef = ref(db, "pending_transfers");

onValue(pendingTransfersRef, (snapshot) => {
  try {
    const pendingTransfers = snapshot.val();

    if (pendingTransfers) {
      const transferArray = Object.entries(pendingTransfers).map(([key, transfer]) => ({
        id: key,
        tid: transfer.tid,
        amount: transfer.saveAmount,
        percentage: transfer.savingsPercent,
        sender: transfer.sender,
        originalAmount: transfer.amount,
        message: transfer.rawMessage,
        createdAt: transfer.createdAt,
        approvedAt: transfer.approvedAt,
        status: "pending",
        requiresProof: true // PROOF REQUIRED BEFORE MARKING SUCCESS
      }));

      console.log(`⏳ PENDING TRANSFERS (Macrodroid Ready - Proof Required):`, transferArray);
      console.log(`📊 Count: ${transferArray.length} transfers waiting for proof from Macrodroid`);

      // Log each transfer for easy Macrodroid detection
      transferArray.forEach((transfer, index) => {
        console.log(`${index + 1}. ✅ AUTO-APPROVED MK ${transfer.amount} | TID: ${transfer.tid} | FROM: ${transfer.sender} | PROOF: REQUIRED`);
      });
    } else {
      console.log("✅ No pending transfers - all have been completed with proof!");
    }
  } catch (error) {
    console.error("Failed to load pending transfers:", error);
  }
});

// ----------------------------
// FIREBASE: ALL TRANSACTIONS (For Dashboard)
// ----------------------------

const transactionsRef = ref(db, "transactions");

onValue(transactionsRef, (snapshot) => {
  try {
    const data = snapshot.val();

    if (!data) {
      renderDashboard(getOfflineTransactions());
      return;
    }

    const transactions = Object.values(data);
    const existing = getOfflineTransactions();

    const existingIds = new Set(
      existing.map(x => x.tid || x.message)
    );

    // Process each transaction
    transactions.forEach(t => {
      const key = t.tid || t.message;

      if (!existingIds.has(key)) {
        saveOfflineTransaction(t);

        // Parse transaction
        const parsed = parseTransaction(t.message);
        
        // AUTO-APPROVE: Create pending transfer immediately if savings >= 100
        if (parsed && parsed.requiresTransfer) {
          const tid = parsed.tid;
          
          // Check if already in pending_transfers
          const checkRef = ref(db, `pending_transfers/${tid}`);
          onValue(checkRef, (checkSnapshot) => {
            if (!checkSnapshot.exists()) {
              // AUTO-APPROVE: Add to pending_transfers with approval timestamp
              push(ref(db, "pending_transfers"), {
                tid: parsed.tid,
                saveAmount: parsed.saveAmount,
                savingsPercent: parsed.savingsPercent,
                sender: parsed.sender,
                amount: parsed.amount,
                rawMessage: parsed.rawMessage,
                createdAt: Date.now(),
                approvedAt: Date.now(), // AUTOMATIC APPROVAL TIMESTAMP
                approvedBy: "auto-system",
                status: "pending", // PENDING UNTIL PROOF RECEIVED
                requiresProof: true // MUST HAVE PROOF BEFORE SUCCESS
              });
              console.log(`✅ AUTO-APPROVED & QUEUED: MK ${parsed.saveAmount} (TID: ${tid}) - Awaiting proof from Macrodroid`);
            }
          }, { onlyOnce: true });
        }
      }
    });

    console.log(`📊 Total Transactions: ${transactions.length}`);
    renderDashboard(transactions);

  } catch (error) {
    console.error("Dashboard update failed:", error);
    renderDashboard(getOfflineTransactions());
  }
});

// ----------------------------
// LISTEN FOR COMPLETION MESSAGES FROM MACRODROID (PROOF VERIFICATION)
// ----------------------------

const completionMessagesRef = ref(db, "completion_messages");

onValue(completionMessagesRef, (snapshot) => {
  try {
    const messages = snapshot.val();

    if (messages) {
      Object.entries(messages).forEach(([key, message]) => {
        if (message && !message.processed) {
          const { tid, successMessage, timestamp } = message;

          // VERIFY PROOF MESSAGE EXISTS AND IS VALID
          if (!successMessage || successMessage.trim().length === 0) {
            console.error(`❌ REJECTED: No proof message for TID ${tid}`);
            return;
          }

          console.log(`📨 PROOF RECEIVED from Macrodroid:`);
          console.log(`   TID: ${tid}`);
          console.log(`   Proof: "${successMessage}"`);
          console.log(`   Time: ${new Date(timestamp).toLocaleString()}`);

          // ONLY MARK AS SUCCESS IF PROOF EXISTS
          completeTransferWithProof(tid, successMessage, timestamp, key);
        }
      });
    }
  } catch (error) {
    console.error("Failed to process completion messages:", error);
  }
});

// ----------------------------
// COMPLETE TRANSFER ONLY WITH VALID PROOF MESSAGE
// ----------------------------

async function completeTransferWithProof(tid, successMessage, macrodroidTimestamp, messageKey) {
  try {
    // VALIDATION: Check that proof message is not empty
    if (!successMessage || successMessage.trim().length === 0) {
      console.error(`❌ Cannot complete transfer ${tid}: No valid proof message`);
      return { success: false, message: "No valid proof message provided" };
    }

    // Find the pending transfer with this TID
    const pendingSnapshot = await new Promise((resolve) => {
      onValue(pendingTransfersRef, resolve, { onlyOnce: true });
    });

    const pendingData = pendingSnapshot.val();
    let transferKey = null;
    let transferData = null;

    // Find matching transfer by TID
    if (pendingData) {
      Object.entries(pendingData).forEach(([key, transfer]) => {
        if (transfer.tid === tid) {
          transferKey = key;
          transferData = transfer;
        }
      });
    }

    if (!transferKey || !transferData) {
      console.error(`❌ Transfer not found in pending_transfers for TID: ${tid}`);
      // Mark message as failed
      update(ref(db, `completion_messages/${messageKey}`), {
        processed: true,
        processedAt: Date.now(),
        result: "failed",
        reason: "Transfer not found in pending"
      });
      return { success: false, message: "Transfer not found in pending" };
    }

    // SUCCESS: Transfer found, proof message exists - Archive with proof
    console.log(`✅ ARCHIVING TRANSFER WITH PROOF: ${tid}`);
    
    await push(ref(db, "completed_transfers"), {
      ...transferData,
      completedAt: Date.now(),
      macrodroidCompletedAt: macrodroidTimestamp,
      completedBy: "macrodroid",
      status: "completed",
      proofMessage: successMessage, // PROOF OF COMPLETION FROM MACRODROID
      proofMessageTimestamp: macrodroidTimestamp,
      verified: true
    });

    // Remove from pending transfers
    await remove(ref(db, `pending_transfers/${transferKey}`));

    // Mark completion message as processed
    update(ref(db, `completion_messages/${messageKey}`), {
      processed: true,
      processedAt: Date.now(),
      result: "success",
      transferCompleted: true
    });

    console.log(`✅ SUCCESS: Transfer ${tid} marked as completed with proof`);
    console.log(`   Proof stored: "${successMessage}"`);
    
    return { 
      success: true, 
      message: `Transfer ${tid} completed and archived with Macrodroid proof`,
      proof: successMessage
    };

  } catch (error) {
    console.error("Error completing transfer with proof:", error);
    return { success: false, error: error.message };
  }
}

// ----------------------------
// EXPORT FOR MACRODROID API
// ----------------------------

export async function getPendingTransfersForMacrodroid() {
  return new Promise((resolve, reject) => {
    onValue(pendingTransfersRef, (snapshot) => {
      const pendingTransfers = snapshot.val();
      if (pendingTransfers) {
        const transferArray = Object.entries(pendingTransfers).map(([key, transfer]) => ({
          id: key,
          tid: transfer.tid,
          amount: transfer.saveAmount,
          percentage: transfer.savingsPercent,
          sender: transfer.sender,
          originalAmount: transfer.amount,
          message: transfer.rawMessage,
          createdAt: transfer.createdAt,
          approvedAt: transfer.approvedAt,
          approvedBy: transfer.approvedBy,
          status: "pending",
          requiresProof: true
        }));
        resolve(transferArray);
      } else {
        resolve([]);
      }
    }, reject);
  });
}

// MACRODROID SENDS SUCCESS MESSAGE WITH PROOF HERE
export async function sendTransferCompletionMessage(tid, successMessage) {
  try {
    // VALIDATION: Ensure proof message exists and has content
    if (!successMessage || successMessage.trim().length === 0) {
      console.error(`❌ Cannot send completion: No proof message provided for TID ${tid}`);
      return { success: false, error: "Proof message is required and cannot be empty" };
    }

    // Macrodroid sends the success/proof message
    // Example: "Transfer successful. Confirmation: TXN#123456789 sent to Account ending in 5678"
    
    await push(ref(db, "completion_messages"), {
      tid: tid,
      successMessage: successMessage, // MANDATORY PROOF MESSAGE FROM MACRODROID
      timestamp: Date.now(),
      processed: false,
      requiresProof: true
    });

    console.log(`📨 Completion message with proof queued for processing: ${tid}`);
    console.log(`   Proof: "${successMessage}"`);
    return { success: true, message: "Completion message with proof received and will be processed" };
  } catch (error) {
    console.error("Failed to send completion message:", error);
    return { success: false, error: error.message };
  }
}

// ALTERNATIVE: Direct completion with proof
export async function completeTransferFromMacrodroid(tid, successMessage) {
  try {
    // VALIDATION: Proof message is mandatory
    if (!successMessage || successMessage.trim().length === 0) {
      console.error(`❌ Cannot complete transfer without proof message for TID ${tid}`);
      return { success: false, error: "Proof message is required" };
    }

    // Find the pending transfer
    const pendingSnapshot = await new Promise((resolve) => {
      onValue(pendingTransfersRef, resolve, { onlyOnce: true });
    });

    const pendingData = pendingSnapshot.val();
    let transferKey = null;
    let transferData = null;

    if (pendingData) {
      Object.entries(pendingData).forEach(([key, transfer]) => {
        if (transfer.tid === tid) {
          transferKey = key;
          transferData = transfer;
        }
      });
    }

    if (!transferKey || !transferData) {
      console.error(`❌ Transfer not found in pending for TID: ${tid}`);
      return { success: false, message: "Transfer not found in pending" };
    }

    // Archive with proof
    await push(ref(db, "completed_transfers"), {
      ...transferData,
      completedAt: Date.now(),
      completedBy: "macrodroid",
      status: "completed",
      proofMessage: successMessage, // MANDATORY PROOF
      proofMessageTimestamp: Date.now(),
      verified: true
    });

    // Remove from pending
    await remove(ref(db, `pending_transfers/${transferKey}`));

    console.log(`✅ Direct completion success: ${tid}`);
    console.log(`   Proof: "${successMessage}"`);
    return { success: true, message: `Transfer ${tid} completed with proof` };
  } catch (error) {
    console.error("Macrodroid completion failed:", error);
    return { success: false, error: error.message };
  }
}
