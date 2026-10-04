/* Publish-time config. Empty checkout URLs = buy buttons show "coming soon". Filled only after Nick's SEND creates the links. */
window.LT_CONFIG = {
  soloUrl: 'https://buy.stripe.com/6oU5kEb0CfR96tg8sU5c400',      // Stripe Payment Link: AudienceTrim Solo $29 (TBD by SEND exp-003-launch)
  agencyUrl: 'https://buy.stripe.com/4gM7sMd8K5cvaJw10s5c401',    // Stripe Payment Link: AudienceTrim Agency $79 (TBD)
  supportEmail: 'nxrivard@gmail.com',   // same contact Nick put on the Dedupe Pilot site; confirm in SEND
  operator: '',              // Stripe account business name; fill at setup
  revoked: []       // leaked license key ids (payload.k) go here
};
