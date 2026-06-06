// ===========================
// USSD SERVICE
// ===========================
// Handles automatic transfers to designated savings account via USSD

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// ===========================
// USSD CODE BUILDERS
// ===========================

/**
 * Build USSD code for Airtel Money transfer
 * Format: *165*1*1*[amount]*[phone]#
 */
export function buildAirtelUSSD(amount, destinationPhone) {
  try {
    // Remove special characters from phone
    const cleanPhone = destinationPhone.replace(/[^0-9]/g, '');
    const formattedPhone = cleanPhone.endsWith('265') 
      ? '0' + cleanPhone.slice(3) 
      : cleanPhone;
    
    return `*165*1*1*${amount}*${formattedPhone}#`;
  } catch (error) {
    console.error('❌ Airtel USSD build error:', error);
    return null;
  }
}

/**
 * Build USSD code for TNM Mpamba transfer
 * Format: *174*1*1*[amount]*[phone]#
 */
export function buildTNMUSSD(amount, destinationPhone) {
  try {
    const cleanPhone = destinationPhone.replace(/[^0-9]/g, '');
    const formattedPhone = cleanPhone.endsWith('265') 
      ? '0' + cleanPhone.slice(3) 
      : cleanPhone;
    
    return `*174*1*1*${amount}*${formattedPhone}#`;
  } catch (error) {
    console.error('❌ TNM USSD build error:', error);
    return null;
  }
}

/**
 * Build USSD code for Vodacom M-Pesa transfer
 * Format: *123*1*[amount]*[phone]#
 */
export function buildVodacomUSSD(amount, destinationPhone) {
  try {
    const cleanPhone = destinationPhone.replace(/[^0-9]/g, '');
    const formattedPhone = cleanPhone.endsWith('265') 
      ? '0' + cleanPhone.slice(3) 
      : cleanPhone;
    
    return `*123*1*${amount}*${formattedPhone}#`;
  } catch (error) {
    console.error('❌ Vodacom USSD build error:', error);
    return null;
  }
}

/**
 * Get USSD builder based on network
 */
function getUSSDBuilder(network) {
  const builders = {
    'airtel': buildAirtelUSSD,
    'tnm': buildTNMUSSD,
    'vodacom': buildVodacomUSSD,
  };
  return builders[network.toLowerCase()] || buildAirtelUSSD;
}

// ===========================
// TRANSFER EXECUTION
// ===========================

/**
 * Execute USSD transfer via Macrodroid automation
 */
export async function executeUSSDTransfer(amount, destinationPhone, network = 'airtel', db) {
  try {
    console.log(`\n💸 EXECUTING USSD TRANSFER`);
    console.log(`   Amount: MK ${amount}`);
    console.log(`   To: ${destinationPhone}`);
    console.log(`   Network: ${network}`);

    // Build USSD code
    const ussdBuilder = getUSSDBuilder(network);
    const ussdCode = ussdBuilder(amount, destinationPhone);

    if (!ussdCode) {
      throw new Error('Failed to build USSD code');
    }

    console.log(`   USSD Code: ${ussdCode}`);

    // Generate unique request ID
    const requestId = `USSD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store transfer request in Firebase
    const { ref, push } = await import('firebase/database');
    
    await push(ref(db, 'transfers/pending'), {
      requestId,
      amount,
      destinationPhone,
      network,
      ussdCode,
      status: 'initiated',
      createdAt: Date.now(),
      completedAt: null,
      confirmationSMS: null
    });

    console.log(`✅ USSD transfer initiated successfully`);
    console.log(`   Request ID: ${requestId}`);
    
    return {
      success: true,
      amount,
      destinationPhone,
      network,
      ussdCode,
      requestId,
      timestamp: Date.now(),
      status: 'initiated',
      instructions: `Ask user to confirm the USSD prompt on their device: ${ussdCode}`
    };

  } catch (error) {
    console.error('❌ USSD transfer error:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: Date.now()
    };
  }
}

// ===========================
// AUTO-TRANSFER PROCESSOR
// ===========================

/**
 * Process auto-transfers for approved savings
 */
export async function processAutoTransfers(db) {
  try {
    console.log('\n🔄 Processing auto-transfers...');

    const transferAccount = {
      name: process.env.TRANSFER_ACCOUNT_NAME,
      phone: process.env.TRANSFER_ACCOUNT_PHONE,
      network: process.env.TRANSFER_ACCOUNT_NETWORK,
      minAmount: parseInt(process.env.MIN_TRANSFER_AMOUNT || 100),
      maxAmount: parseInt(process.env.MAX_TRANSFER_AMOUNT || 50000)
    };

    if (!process.env.AUTO_TRANSFER_ENABLED || process.env.AUTO_TRANSFER_ENABLED === 'false') {
      console.log('ℹ️  Auto-transfer is disabled');
      return { success: false, message: 'Auto-transfer disabled' };
    }

    if (!transferAccount.phone) {
      console.log('⚠️  Transfer account phone not configured');
      return { success: false, message: 'Transfer account not configured' };
    }

    // Get all pending transfers
    const { ref, onValue } = await import('firebase/database');
    
    let pendingTransfers = [];

    // Collect all pending transfers from all users
    await new Promise((resolve) => {
      onValue(ref(db, 'users'), (snapshot) => {
        const usersData = snapshot.val();
        
        if (usersData) {
          Object.entries(usersData).forEach(([userId, userData]) => {
            if (userData.transactions) {
              Object.entries(userData.transactions).forEach(([txnId, transaction]) => {
                if (
                  transaction.savingsStatus === 'approved' &&
                  transaction.saveAmount >= transferAccount.minAmount &&
                  transaction.saveAmount <= transferAccount.maxAmount &&
                  !transaction.transferSent
                ) {
                  pendingTransfers.push({
                    userId,
                    txnId,
                    amount: transaction.saveAmount,
                    transaction
                  });
                }
              });
            }
          });
        }
        resolve();
      }, { onlyOnce: true });
    });

    // Process each pending transfer
    let successCount = 0;
    let failureCount = 0;

    for (const transfer of pendingTransfers) {
      try {
        const result = await executeUSSDTransfer(
          transfer.amount,
          transferAccount.phone,
          transferAccount.network,
          db
        );

        if (result.success) {
          // Mark transaction as transfer sent
          const { ref, update } = await import('firebase/database');
          await update(ref(db, `users/${transfer.userId}/transactions/${transfer.txnId}`), {
            transferSent: true,
            transferRequestId: result.requestId,
            transferTimestamp: result.timestamp,
            transferStatus: 'initiated'
          });

          // Log transfer in audit trail
          const { push } = await import('firebase/database');
          await push(ref(db, 'audit/transfers'), {
            userId: transfer.userId,
            amount: transfer.amount,
            destination: transferAccount.phone,
            network: transferAccount.network,
            requestId: result.requestId,
            timestamp: Date.now(),
            status: 'success'
          });

          successCount++;
        } else {
          failureCount++;
        }
      } catch (error) {
        console.error(`❌ Failed to process transfer for ${transfer.userId}:`, error);
        failureCount++;
      }
    }

    console.log(`✅ Auto-transfer processing complete: ${successCount} successful, ${failureCount} failed`);
    return {
      success: true,
      processed: pendingTransfers.length,
      successful: successCount,
      failed: failureCount,
      account: transferAccount.name
    };

  } catch (error) {
    console.error('❌ Auto-transfer processor error:', error);
    return { success: false, error: error.message };
  }
}

// ===========================
// TRANSFER VERIFICATION
// ===========================

/**
 * Verify transfer receipt via SMS confirmation
 */
export async function verifyTransferReceipt(requestId, confirmationSMS, db) {
  try {
    console.log(`\n✅ VERIFYING TRANSFER RECEIPT`);
    console.log(`   Request ID: ${requestId}`);
    console.log(`   Confirmation: ${confirmationSMS.substring(0, 50)}...`);

    const { ref, update, push } = await import('firebase/database');

    // Update transfer status to completed
    await update(ref(db, `transfers/pending/${requestId}`), {
      status: 'completed',
      confirmationSMS: confirmationSMS,
      verifiedAt: Date.now()
    });

    // Move to completed transfers
    const { onValue } = await import('firebase/database');
    
    await new Promise((resolve) => {
      onValue(ref(db, `transfers/pending/${requestId}`), async (snapshot) => {
        const transferData = snapshot.val();
        if (transferData) {
          await push(ref(db, 'transfers/completed'), {
            ...transferData,
            completedAt: Date.now(),
            confirmationSMS
          });
        }
        resolve();
      }, { onlyOnce: true });
    });

    // Log audit trail
    await push(ref(db, 'audit/transfer_confirmations'), {
      requestId,
      confirmationSMS,
      verifiedAt: Date.now()
    });

    console.log(`✅ Transfer verified and marked as completed`);
    return { success: true, requestId, status: 'completed' };

  } catch (error) {
    console.error('❌ Transfer verification error:', error);
    return { success: false, error: error.message };
  }
}

export default {
  executeUSSDTransfer,
  processAutoTransfers,
  verifyTransferReceipt,
  buildAirtelUSSD,
  buildTNMUSSD,
  buildVodacomUSSD
};
