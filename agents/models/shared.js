'use strict';
const mongoose  = require('mongoose');
const Anthropic = require('@anthropic-ai/sdk');
const DEFAULT_OWNER = (process.env.PRIMARY_OWNER_EMAIL || 'samerkarwande3@gmail.com').trim().toLowerCase();
function ownerUserId() {
  return ((this && this.owner_email) || DEFAULT_OWNER).toString().trim().toLowerCase();
}

const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const leadSchema = new mongoose.Schema({
  email:    { type: String, index: true },
  phone:    { type: String, index: true },
  name:     String, business: String, budget: String, location: String, purpose: String,
  leadScore:       { type: Number, default: 0 },
  status:          { type: String, enum: ['new','contacted','qualified','hot','converted','lost'], default: 'new' },
  tags:            [String],
  source:          { type: String, default: 'unknown' },
  marketingOptOut: { type: Boolean, default: false },
  emailOptOut:     { type: Boolean, default: false },
  whatsappOptOut:  { type: Boolean, default: false },
  owner_email:     { type: String, index: true, default: DEFAULT_OWNER },
  user_id:         { type: String, index: true, default: ownerUserId },
  lastInteraction: Date,
  createdAt:       { type: Date, default: Date.now },
});

const conversationSchema = new mongoose.Schema({
  leadId:    { type: String, index: true },
  userId:    { type: String, index: true },
  channel:   { type: String, enum: ['whatsapp','email','call'], default: 'whatsapp' },
  role:      { type: String, enum: ['user','assistant'], required: true },
  content:   { type: String, required: true },
  subject:   String, messageId: String,
  owner_email:{ type: String, index: true, default: DEFAULT_OWNER },
  user_id:   { type: String, index: true, default: ownerUserId },
  timestamp: { type: Date, default: Date.now, index: true },
});

const emailLogSchema = new mongoose.Schema({
  to: String, from: String, subject: String, body: String, resendId: String,
  owner_email: { type: String, index: true, default: DEFAULT_OWNER },
  user_id:     { type: String, index: true, default: ownerUserId },
  status:   { type: String, enum: ['sent','failed','opened','replied'], default: 'sent' },
  campaign: String,
  sentAt:   { type: Date, default: Date.now },
});

const userProfileSchema = new mongoose.Schema({
  userId:          { type: String, required: true, index: true },
  name:            String, budget: String, location: String, purpose: String,
  leadScore:       { type: Number, default: 0 },
  status:          { type: String, enum: ['new','qualified','hot','cold','converted'], default: 'new' },
  marketingOptOut: { type: Boolean, default: false },
  owner_email:     { type: String, index: true, default: DEFAULT_OWNER },
  user_id:         { type: String, index: true, default: ownerUserId },
  tags: [String], lastInteraction: Date,
  createdAt:       { type: Date, default: Date.now },
});

leadSchema.index({ owner_email: 1, user_id: 1, email: 1 });
leadSchema.index({ owner_email: 1, user_id: 1, phone: 1 });
conversationSchema.index({ owner_email: 1, user_id: 1, userId: 1, timestamp: -1 });
emailLogSchema.index({ owner_email: 1, user_id: 1, to: 1, sentAt: -1 });
userProfileSchema.index({ owner_email: 1, user_id: 1, userId: 1 }, { unique: true });

const Lead         = mongoose.model('Lead',         leadSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);
const EmailLog     = mongoose.model('EmailLog',     emailLogSchema);
const UserProfile  = mongoose.model('UserProfile',  userProfileSchema);

module.exports = { claude, Lead, Conversation, EmailLog, UserProfile };
