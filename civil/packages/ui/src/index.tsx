import React from 'react'

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ children, ...props }) => (
  <button className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700" {...props}>
    {children}
  </button>
)
