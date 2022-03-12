import useInterval from 'useInterval'
import multiplyBy2 from 'multiplyBy2'

export default function ATest() {
  const num = useInterval(1000)
  const value = multiplyBy2(num)

  return <h1>ATest: {value}</h1>
}
