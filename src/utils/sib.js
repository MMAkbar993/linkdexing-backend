require("dotenv/config");

var SibApiV3Sdk = require("sib-api-v3-sdk");

var defaultClient = SibApiV3Sdk.ApiClient.instance;

// Configure API key authorization: api-key
var apiKey = defaultClient.authentications["api-key"];
apiKey.apiKey = process.env.SIB_API_KEY;

module.exports = {
  TransactionalEmailsApi: new SibApiV3Sdk.TransactionalEmailsApi(),
  ContactApi: new SibApiV3Sdk.ContactsApi(),
};
