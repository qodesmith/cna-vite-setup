import {useState, useEffect} from 'react'

export default function useInterval(time = 1000) {
  const [num, setNum] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setNum(n => n + 1)
    }, time)

    return () => clearInterval(interval)
  }, [])

  return num
}
