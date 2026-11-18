import React from 'react';

export async function withTestAuth(vite, Component) {
  const { AuthContext } = await vite.ssrLoadModule('/src/auth/AuthContext.tsx');
  const value = { status: 'anonymous', identity: null, getIdToken: async () => null };
  return (props) => React.createElement(AuthContext.Provider, { value }, React.createElement(Component, props));
}
