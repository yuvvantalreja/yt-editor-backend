import express from 'express';
import passport from 'passport';

import BaseController from './base';
import { redirectUrl, authUrl } from '../urls';
import crypto from 'crypto';

// Enables passport to recognize the configuration.
require('../../config/passport');

/**
 * Controller for OAuthentication via GitHub.
 *
 * See [[IBaseController]] for more details.
 */
class AuthController implements BaseController {
  public path = authUrl.main;

  public router = express.Router();

  /**
   * Constructor of `AuthController`.
   */
  constructor() {
    this.initializeRoutes();
  }

  /**
   * Initialization of routes of `AuthController`.
   */
  private initializeRoutes = () => {
    this.router.get(
      this.path,
      passport.authenticate('github', { scope: 'gist', session: false })
    );
    this.router.get(
      authUrl.callback,
      passport.authenticate('github', { session: false }),
      this.success
    );
    this.router.get(authUrl.logout, this.logout);
    this.router.get(authUrl.isAuthenticated, this.loggedIn);
    this.router.get(authUrl.getGithubToken, this.getGithubToken);
  };

  /**
   * Handle OPTIONS requests (CORS preflight)
   */
  private handleOptions = (req, res) => {
    const origin = req.headers.origin || '*';

    if (origin === 'null') {
      res.header('Access-Control-Allow-Origin', 'null');
    } else {
      res.header('Access-Control-Allow-Origin', origin);
    }

    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token, Cache-Control, Pragma, Expires');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Expose-Headers', 'Content-Type, Authorization, X-Auth-Token');
    res.status(200).end();
  };

  /**
   * Generate a secure token containing encrypted user data
   * @returns {string} A secure token
   */
  private generateToken = (user: any): string => {
    if (!user || !user._json) return '';

    const randomPart = crypto.randomBytes(16).toString('hex');

    // Simple encoding, can use JWT or better encryption
    const userInfo = {
      id: user._json.id,
      login: user._json.login,
      name: user._json.name,
      avatar_url: user._json.avatar_url,
      access_token: user.accessToken,
      randomId: randomPart,
      timestamp: Date.now()
    };

    const dataString = JSON.stringify(userInfo);
    const signature = crypto
      .createHmac('sha256', process.env.SESSION_SECRET)
      .update(dataString)
      .digest('hex');

    const token = Buffer.from(JSON.stringify({
      data: dataString,
      signature
    })).toString('base64');

    return token;
  };

  /**
   * Validate a token and extract user info
   * @param {string} token The token to validate
   * @returns {any} The user info if token is valid, null otherwise
   */
  private validateToken = (token: string): any => {
    if (!token) return null;

    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
      const { data, signature } = decoded;

      const expectedSignature = crypto
        .createHmac('sha256', process.env.SESSION_SECRET)
        .update(data)
        .digest('hex');

      if (signature !== expectedSignature) {
        console.error('Invalid token signature');
        return null;
      }

      const userInfo = JSON.parse(data);

      const tokenAge = Date.now() - userInfo.timestamp;
      if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
        console.error('Token expired');
        return null;
      }

      return {
        _json: {
          id: userInfo.id,
          login: userInfo.login,
          name: userInfo.name,
          avatar_url: userInfo.avatar_url
        },
        username: userInfo.login,
        accessToken: userInfo.access_token
      };
    } catch (error) {
      console.error('Token validation error:', error);
      return null;
    }
  };

  /**
   * Success callback after authentication.
   *
   * @param {Response} res Response object
   */
  private success = (req, res) => {
    console.log('Authentication successful, generating token');

    let authToken = '';
    let githubAccessToken = '';
    try {
      if (req.user) {
        console.log('User profile received:', req.user._json ? req.user._json.login : 'Unknown');
        authToken = this.generateToken(req.user);
        githubAccessToken = req.user.accessToken;
        console.log('Token generated successfully');
      } else {
        console.error('No user data received from GitHub authentication');
      }
    } catch (error) {
      console.error('Error generating authentication token:', error);
    }

    res.send(
      `<html>
        <script>
          const authToken = "${authToken}";
          
          if (authToken) {
            console.log("Storing auth token in localStorage");
            localStorage.setItem('vega_editor_auth_token', authToken);
          } else {
            console.error("No auth token received");
          }
          
          if (window.opener === null) {
            window.location = '${redirectUrl.successful}'
          }
          else {
            try {
              window.opener.postMessage(
                {type: 'auth', token: authToken}, '*'
              )
              window.close()
            } catch (e) {
              console.error("Error posting message to opener:", e);
              window.location = '${redirectUrl.successful}'
            }
          }
        </script>
      </html>`
    );
  };

  /**
   * Logging out of a session.
   *
   * @param {Request} req Request object
   * @param {Response} res Response object
   */
  private logout = (req, res) => {
    const origin = req.headers.origin || '*';
    if (origin === 'null') {
      res.header('Access-Control-Allow-Origin', 'null');
    } else {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Auth-Token');
    res.header('Access-Control-Allow-Credentials', 'true');

    res.send(
      `<html>
        <script>
          localStorage.removeItem('vega_editor_auth_token');
          localStorage.removeItem('vega_editor_github_token');
          localStorage.removeItem('vega_editor_auth_data');
          
          if (window.opener === null) {
            window.location.assign('${redirectUrl.successful}')
          }
          else {
            try {
              window.opener.postMessage(
                {type: 'auth'}, '*'
              )
              window.close()
            } catch (e) {
              window.location.assign('${redirectUrl.successful}')
            }
          }
        </script>
      </html>`
    );
  };

  /**
   * Checks if a user is authenticated.
   *
   * @param {Request} req Request object
   * @param {Response} res Response object
   */
  private loggedIn = (req, res) => {
    const origin = req.headers.origin || '*';
    if (origin === 'null') {
      res.header('Access-Control-Allow-Origin', 'null');
    } else {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Auth-Token');
    res.header('Access-Control-Allow-Credentials', 'true');

    // Checking for token-based auth
    const authToken = req.headers['x-auth-token'] as string;
    let tokenUser = null;

    if (authToken) {
      tokenUser = this.validateToken(authToken);
    }

    if (!req.isAuthenticated() && !tokenUser) {
      return res.send({
        isAuthenticated: false
      });
    }

    const user = tokenUser || req.user;
    res.send({
      isAuthenticated: true,
      handle: user.username,
      name: user._json.name,
      profilePicUrl: user._json.avatar_url,
      authToken: tokenUser ? authToken : this.generateToken(user),
      githubAccessToken: tokenUser.accessToken
    });
  };

  /**
   * Provides the GitHub access token for the authenticated user.
   * This endpoint should only be called when needed for GitHub API calls.
   *
   * @param {Request} req Request object
   * @param {Response} res Response object
   */
  private getGithubToken = (req, res) => {
    const origin = req.headers.origin || '*';
    if (origin === 'null') {
      res.header('Access-Control-Allow-Origin', 'null');
    } else {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Auth-Token');
    res.header('Access-Control-Allow-Credentials', 'true');

    const authToken = req.headers['x-auth-token'] as string;
    let tokenUser = null;

    if (authToken) {
      tokenUser = this.validateToken(authToken);
    }

    if (!req.isAuthenticated() && !tokenUser) {
      return res.status(401).send({
        error: 'Not authenticated'
      });
    }

    const user = tokenUser || req.user;

    res.send({
      githubAccessToken: user.accessToken
    });
  };
}

/**
 * _Export `AuthController`._
 */
export default AuthController;
