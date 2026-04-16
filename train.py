# train.py
import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score
import pickle

# Use IEEE-CIS Fraud dataset (Kaggle) or generate synthetic data
# Features must mirror what mlFraudScore() already computes:
# f0: amount/balance ratio
# f1: odd hour (0/0.5/1.0)
# f2: unknown recipient (0 or 1)
# f3: tx frequency in last 5 mins
# f4: daily spend as fraction of start balance
# f6: recipient risk registry score (0-1)
# f7: z-score deviation from user avg (0-1)
# f8: off-network flag (0 or 1)

FEATURE_COLS = ['amt_bal_ratio', 'odd_hour', 'unknown_recipient',
                'tx_frequency', 'daily_spend_pct', 'recipient_risk',
                'zscore_dev', 'off_network']

df = pd.read_csv('fraud_data.csv')  # or synthetic
X = df[FEATURE_COLS]
y = df['is_fraud']

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled = scaler.transform(X_test)

model = xgb.XGBClassifier(
    n_estimators=300,
    max_depth=6,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    scale_pos_weight=len(y_train[y_train==0]) / len(y_train[y_train==1]),  # handle imbalance
    use_label_encoder=False,
    eval_metric='auc',
    random_state=42
)

model.fit(X_train_scaled, y_train,
          eval_set=[(X_test_scaled, y_test)],
          early_stopping_rounds=20,
          verbose=False)

print(f"ROC-AUC: {roc_auc_score(y_test, model.predict_proba(X_test_scaled)[:,1]):.4f}")

# Save both artifacts
model.save_model('model.json')
with open('scaler.pkl', 'wb') as f:
    pickle.dump(scaler, f)