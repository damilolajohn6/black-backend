const baseEmailTemplate = (content, title, buttonText, buttonUrl) => `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
      body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4; }
      .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; }
      .header { background-color: #007bff; padding: 20px; text-align: center; color: #ffffff; }
      .header h1 { margin: 0; font-size: 24px; }
      .content { padding: 20px; color: #333333; line-height: 1.6; }
      .content p { margin: 0 0 10px; }
      .button { display: inline-block; padding: 12px 24px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: bold; text-align: center; }
      .footer { background-color: #f4f4f4; padding: 10px; text-align: center; color: #666666; font-size: 12px; }
      .footer a { color: #007bff; text-decoration: none; }
      @media only screen and (max-width: 600px) {
        .container { width: 100%; margin: 0; }
        .header h1 { font-size: 20px; }
        .content { padding: 15px; }
        .button { width: 100%; box-sizing: border-box; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>${title}</h1>
      </div>
      <div class="content">
        ${content}
        ${
          buttonText && buttonUrl
            ? `<p style="text-align: center;"><a href="${buttonUrl}" class="button">${buttonText}</a></p>`
            : ""
        }
      </div>
      <div class="footer">
        <p>&copy; ${new Date().getFullYear()} Social Platform. All rights reserved.</p>
        <p><a href="https://yourplatform.com">Visit our website</a> | <a href="https://yourplatform.com/support">Contact Support</a></p>
      </div>
    </div>
  </body>
  </html>
`;

const newFollowerEmail = ({
  recipientUsername,
  followerUsername,
  followerProfileUrl,
}) => {
  const content = `
    <p>Hello ${recipientUsername},</p>
    <p><strong>${followerUsername}</strong> has started following you! Check out their profile to learn more about them.</p>
  `;
  return baseEmailTemplate(
    content,
    "New Follower",
    "View Profile",
    followerProfileUrl
  );
};

const newMessageEmail = ({
  recipientUsername,
  senderUsername,
  messageContent,
  conversationUrl,
}) => {
  const content = `
    <p>Hello ${recipientUsername},</p>
    <p>You have a new message from <strong>${senderUsername}</strong>:</p>
    <p style="background-color: #f9f9f9; padding: 10px; border-left: 4px solid #007bff;">${messageContent}</p>
    <p>Reply to them directly in the conversation.</p>
  `;
  return baseEmailTemplate(
    content,
    "New Message",
    "View Message",
    conversationUrl
  );
};

const addedToGroupEmail = ({
  recipientUsername,
  groupName,
  addedByUsername,
  groupUrl,
}) => {
  const content = `
    <p>Hello ${recipientUsername},</p>
    <p>You have been added to the group <strong>${groupName}</strong> by <strong>${addedByUsername}</strong>.</p>
    <p>Join the conversation and connect with other members!</p>
  `;
  return baseEmailTemplate(content, "Added to Group", "View Group", groupUrl);
};

const newCommentEmail = ({
  recipientUsername,
  commenterUsername,
  commentContent,
  postUrl,
}) => {
  const content = `
    <p>Hello ${recipientUsername},</p>
    <p><strong>${commenterUsername}</strong> commented on your post:</p>
    <p style="background-color: #f9f9f9; padding: 10px; border-left: 4px solid #007bff;">${commentContent}</p>
    <p>Check out the conversation and reply!</p>
  `;
  return baseEmailTemplate(content, "New Comment", "View Post", postUrl);
};

const storyViewedEmail = ({ recipientUsername, viewerUsername, storyUrl }) => {
  const content = `
    <p>Hello ${recipientUsername},</p>
    <p><strong>${viewerUsername}</strong> viewed your story. See who else has viewed it!</p>
  `;
  return baseEmailTemplate(content, "Story Viewed", "View Story", storyUrl);
};

const contentDeletedEmail = ({ recipientUsername, contentType, reason }) => {
  const content = `
    <p>Hello ${recipientUsername},</p>
    <p>Your ${contentType} has been removed due to a violation reported with the following reason:</p>
    <p style="background-color: #f9f9f9; padding: 10px; border-left: 4px solid #dc3545;">${reason}</p>
    <p>Please review our <a href="https://yourplatform.com/guidelines">community guidelines</a> to avoid future issues.</p>
  `;
  return baseEmailTemplate(
    content,
    `${contentType.charAt(0).toUpperCase() + contentType.slice(1)} Removed`,
    null,
    null
  );
};

const accountSuspendedEmail = ({ recipientUsername, reason, expiry }) => {
  const content = `
    <p>Hello ${recipientUsername},</p>
    <p>Your account has been suspended due to: <strong>${reason}</strong>.</p>
    <p>${
      expiry
        ? `The suspension will last until ${new Date(expiry).toDateString()}.`
        : "This suspension is indefinite."
    }</p>
    <p>Please contact <a href="https://yourplatform.com/support">support</a> for further details.</p>
  `;
  return baseEmailTemplate(content, "Account Suspended", null, null);
};

module.exports = {
  newFollowerEmail,
  newMessageEmail,
  addedToGroupEmail,
  newCommentEmail,
  storyViewedEmail,
  contentDeletedEmail,
  accountSuspendedEmail,
};
